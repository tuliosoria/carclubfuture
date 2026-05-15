/**
 * Bulk CarQuery catalog ingest — A1-A8.
 *
 * A1: resumeState / saveCheckpoint
 * A2: fetchMakes
 * A3: fetchTrimsForMake
 * A4: ingest() main loop (resumable, deduped, atomic write)
 * A5: enrichWithNhtsa — vPIC cross-reference grouped by (make, year)
 * A6: Optional CarAPI enrichment gated by CARAPI_KEY env var
 * A7: scoreConfidence — high/medium/low based on source confirmations
 * A8: npm wiring (see package.json) + verify-scripts coverage
 *
 * CLI:
 *   node scripts/ingest-cars-catalog-bulk.mjs \
 *     --start-year=1950 --end-year=2024 \
 *     --output=src/lib/data/cars-ml/cars-catalog-bulk.json \
 *     --checkpoint=scripts/output/ingest-checkpoint.json \
 *     [--dry-run]
 */

import { readFile } from "node:fs/promises";
import {
  fetchWithRetry,
  RateLimiter,
  writeJsonAtomic,
  jsonLog,
} from "./_lib/http.mjs";

// Shared 1 req/s rate limiter across all CarQuery calls.
const sharedRl = new RateLimiter(1);

// Default fetch: wraps global fetch with 3-retry exponential backoff.
const defaultFetch = (url) => fetchWithRetry(url);

// ─── A1: Resumable state ──────────────────────────────────────────────────────

/**
 * Read checkpoint from disk. Returns empty default if file is missing or
 * unreadable (first run or clean start).
 */
export async function resumeState(checkpointPath) {
  const empty = { completedMakes: [], lastYear: null };
  try {
    const raw = await readFile(checkpointPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { ...empty };
  }
}

/**
 * Atomically write checkpoint state (via writeJsonAtomic: .tmp → rename).
 */
export async function saveCheckpoint(checkpointPath, state) {
  await writeJsonAtomic(checkpointPath, state);
}

// ─── Slug helper ─────────────────────────────────────────────────────────────

/** Lower-kebab slug; strips anything that isn't [a-z0-9-]. */
export function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── A2: fetchMakes ───────────────────────────────────────────────────────────

/**
 * Fetch all US-market makes for a given year from CarQuery.
 * Returns normalized array: [{ id, display, country, isCommon }]
 *
 * @param {number} year
 * @param {{ fetch?: Function, rateLimiter?: object }} opts
 */
export async function fetchMakes(
  year,
  { fetch: fetchFn = defaultFetch, rateLimiter: rl = sharedRl } = {}
) {
  await rl.take();
  const url = `https://www.carqueryapi.com/api/0.3/?cmd=getMakes&year=${year}&sold_in_us=1`;
  const resp = await fetchFn(url);
  const data = await resp.json();
  return (data.Makes ?? []).map((m) => ({
    id: m.make_id,
    display: m.make_display,
    country: m.make_country,
    isCommon: m.make_is_common,
  }));
}

// ─── A3: fetchTrimsForMake ────────────────────────────────────────────────────

/**
 * Fetch all US-market trims for a given make + year from CarQuery.
 * Makes two rounds of calls: getModels, then getTrims per model.
 * Filters trims where sold_in_us !== "1".
 *
 * @param {string} makeId
 * @param {number} year
 * @param {{ fetch?: Function, rateLimiter?: object, makeDisplay?: string }} opts
 */
export async function fetchTrimsForMake(
  makeId,
  year,
  {
    fetch: fetchFn = defaultFetch,
    rateLimiter: rl = sharedRl,
    makeDisplay = makeId,
  } = {}
) {
  await rl.take();
  const modelsUrl =
    `https://www.carqueryapi.com/api/0.3/?cmd=getModels` +
    `&make=${encodeURIComponent(makeId)}&year=${year}&sold_in_us=1`;
  const modelsResp = await fetchFn(modelsUrl);
  const modelsData = await modelsResp.json();
  const models = modelsData.Models ?? [];

  const trims = [];
  for (const model of models) {
    const modelName = model.model_name;
    await rl.take();
    const trimsUrl =
      `https://www.carqueryapi.com/api/0.3/?cmd=getTrims` +
      `&make=${encodeURIComponent(makeId)}` +
      `&model=${encodeURIComponent(modelName)}` +
      `&year=${year}&sold_in_us=1`;
    const trimsResp = await fetchFn(trimsUrl);
    const trimsData = await trimsResp.json();
    const rawTrims = (trimsData.Trims ?? []).filter(
      (t) => String(t.sold_in_us) === "1"
    );
    for (const t of rawTrims) {
      trims.push({
        carqueryId: String(t.model_id),
        slug: slugify(
          `${year}-${makeId}-${modelName}-${t.model_trim || "base"}`
        ),
        year: Number(year),
        make: makeId,
        makeDisplay,
        model: t.model_name,
        trim: t.model_trim || null,
        bodyStyle: t.model_body || null,
        engineDisplacementCc: t.model_engine_cc
          ? Number(t.model_engine_cc)
          : null,
        cylinders: t.model_engine_cyl ? Number(t.model_engine_cyl) : null,
        fuel: t.model_engine_fuel || null,
        transmission: t.model_transmission_type || null,
        driveType: t.model_drive || null,
        source: "carquery",
      });
    }
  }
  return trims;
}

// ─── A5: NHTSA vPIC cross-reference ──────────────────────────────────────────

/**
 * Enrich rows with NHTSA vPIC data. Groups by (make, year) to issue one
 * API call per unique pair rather than one per row. Sets `nhtsaId` and
 * optionally `nhtsaModelName` on each row in place.
 *
 * @param {object[]} rows
 * @param {{ fetch?: Function, rateLimiter?: object }} opts
 * @returns {Promise<object[]>}
 */
export async function enrichWithNhtsa(
  rows,
  { fetch: fetchFn = defaultFetch, rateLimiter: rl = sharedRl } = {}
) {
  if (!rows.length) return rows;

  // Group rows by "make|year" to minimise API calls.
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.make}|${row.year}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const [key, groupRows] of groups) {
    const pipeIdx = key.indexOf("|");
    const make = key.slice(0, pipeIdx);
    const year = Number(key.slice(pipeIdx + 1));

    await rl.take();
    try {
      const url =
        `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear` +
        `/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`;
      const resp = await fetchFn(url);
      const data = await resp.json();
      const results = data.Results ?? [];

      for (const row of groupRows) {
        const match = results.find(
          (r) => r.Model_Name.toLowerCase() === row.model.toLowerCase()
        );
        if (match) {
          row.nhtsaId = `${match.Make_ID}:${match.Model_ID}`;
          row.nhtsaModelName = match.Model_Name;
        } else {
          row.nhtsaId = null;
        }
      }
    } catch (err) {
      jsonLog({
        operation: "nhtsa.enrich",
        make,
        year,
        error: err instanceof Error ? err.message : String(err),
      });
      for (const row of groupRows) {
        row.nhtsaId = null;
      }
    }
  }

  return rows;
}

// ─── A7: Confidence scoring ───────────────────────────────────────────────────

/**
 * Score a row's data confidence based on how many independent sources
 * confirmed it.
 *
 *   CarQuery present (always) = 1 pt
 *   nhtsaId truthy             = 1 pt
 *   carapiId truthy            = 1 pt
 *
 *   3 pts → "high" | 2 pts → "medium" | ≤1 pt → "low"
 *
 * @param {object} row
 * @returns {"high" | "medium" | "low"}
 */
export function scoreConfidence(row) {
  let points = 1; // CarQuery is always present for rows in this pipeline
  if (row.nhtsaId) points++;
  if (row.carapiId) points++;
  if (points >= 3) return "high";
  if (points === 2) return "medium";
  return "low";
}

// ─── A4: Main ingest loop ─────────────────────────────────────────────────────

/**
 * Main ingest loop. Iterates years from endYear down to startYear,
 * resuming from checkpoint if present. Dedupes by slug and atomically
 * writes sorted output.
 *
 * @param {{
 *   startYear: number,
 *   endYear: number,
 *   checkpointPath: string,
 *   outputPath: string,
 *   fetch?: Function,
 *   rateLimiter?: object,
 *   dryRun?: boolean
 * }} opts
 */
export async function ingest({
  startYear,
  endYear,
  checkpointPath,
  outputPath,
  fetch: fetchFn = defaultFetch,
  rateLimiter: rl = sharedRl,
  dryRun = false,
}) {
  const state = await resumeState(checkpointPath);

  // Dry-run: log years that would be processed, make no API calls.
  if (dryRun) {
    for (let year = endYear; year >= startYear; year--) {
      if (state.lastYear !== null && year >= state.lastYear) {
        jsonLog({ operation: "dry-run-skip", year, reason: "already-complete" });
        continue;
      }
      jsonLog({ operation: "dry-run-would-process", year });
    }
    return [];
  }

  // Load existing output so resumed runs don't lose already-collected data.
  let existingTrims = [];
  try {
    const existing = await readFile(outputPath, "utf8");
    const parsed = JSON.parse(existing);
    existingTrims = Array.isArray(parsed) ? parsed : [];
  } catch {
    // No existing output — starting fresh.
  }
  const allTrims = [...existingTrims];

  for (let year = endYear; year >= startYear; year--) {
    // state.lastYear is the most-recently completed year (going downward).
    // All years >= lastYear have already been collected.
    if (state.lastYear !== null && year >= state.lastYear) {
      continue;
    }

    jsonLog({ operation: "fetch-year-start", year });
    const makes = await fetchMakes(year, { fetch: fetchFn, rateLimiter: rl });

    for (const make of makes) {
      if (state.completedMakes.includes(make.id)) {
        continue;
      }
      jsonLog({ operation: "fetch-make", year, make: make.id });
      const trims = await fetchTrimsForMake(make.id, year, {
        fetch: fetchFn,
        rateLimiter: rl,
        makeDisplay: make.display,
      });
      allTrims.push(...trims);
      state.completedMakes.push(make.id);
      await saveCheckpoint(checkpointPath, state);
    }

    // Year complete: flush output incrementally so checkpoint and file move
    // forward together. Crash after this point loses nothing for this year.
    {
      const bySlugFlush = new Map();
      for (const t of allTrims) bySlugFlush.set(t.slug, t);
      const flushedTrims = [...bySlugFlush.values()].sort((a, b) =>
        a.slug.localeCompare(b.slug)
      );
      await writeJsonAtomic(outputPath, flushedTrims);
    }

    // Reset per-year state and record.
    state.completedMakes = [];
    state.lastYear = year;
    await saveCheckpoint(checkpointPath, state);
    jsonLog({ operation: "fetch-year-done", year });
  }

  // A5: NHTSA cross-reference enrichment.
  await enrichWithNhtsa(allTrims, { fetch: fetchFn, rateLimiter: rl });

  // A6: Optional CarAPI enrichment (gated by CARAPI_KEY).
  if (process.env.CARAPI_KEY) {
    try {
      const { getCarApiToken, enrichWithCarApi } = await import("./_lib/carapi.mjs");
      const token = await getCarApiToken({ fetch: fetchFn, jwt: process.env.CARAPI_KEY });
      await enrichWithCarApi(allTrims, { fetch: fetchFn, rateLimiter: rl, token });
    } catch (err) {
      jsonLog({
        operation: "carapi.enrich",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    jsonLog({ operation: "carapi.skip", reason: "no_key" });
  }

  // Dedupe by slug (last write wins), sort alphabetically.
  const bySlug = new Map();
  for (const t of allTrims) {
    bySlug.set(t.slug, t);
  }
  const sorted = [...bySlug.values()].sort((a, b) =>
    a.slug.localeCompare(b.slug)
  );

  // A7: Confidence scoring — applied after all enrichment, before write.
  for (const row of sorted) {
    row.catalogConfidence = scoreConfidence(row);
  }

  await writeJsonAtomic(outputPath, sorted);
  jsonLog({ operation: "ingest-complete", recordsProcessed: sorted.length });
  return sorted;
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith("ingest-cars-catalog-bulk.mjs")) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? true];
    })
  );

  const startYear = Number(args["start-year"] ?? 1950);
  const endYear = Number(args["end-year"] ?? 2024);
  const outputPath =
    args.output ?? "src/lib/data/cars-ml/cars-catalog-bulk.json";
  const checkpointPath =
    args.checkpoint ?? "scripts/output/ingest-checkpoint.json";
  const dryRun = args["dry-run"] === true || args["dry-run"] === "true";

  ingest({ startYear, endYear, checkpointPath, outputPath, dryRun }).catch(
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
