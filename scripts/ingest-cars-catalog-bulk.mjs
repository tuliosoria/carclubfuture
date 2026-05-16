/**
 * Bulk catalog ingest — NHTSA-primary.
 *
 * Pivoted from CarQuery (host dead — TLS cert serves legacyarcade.com,
 * ELB returns 400) to NHTSA vPIC as the authoritative source for the
 * (year, make, model) universe. NHTSA does NOT return engine, body
 * style, transmission or drive — those fields stay `null` (honesty rule)
 * unless an optional enrichment source fills them in.
 *
 * Pipeline:
 *   1. fetchMakes()           → ~193 passenger-car makes (vehicle type "car")
 *   2. fetchModelsForMakeYear → models for every (make, year) pair
 *   3. emit BulkCatalogRow per (year, make, model) with derived `era`
 *   4. per-year incremental flush → checkpoint + atomic output write
 *   5. optional CarAPI enrichment behind CARAPI_KEY env var
 *   6. (legacy) CarQuery augment behind CARQUERY_ENABLED=1 — host is dead,
 *      so this stays disabled by default.
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

// NHTSA is a public US government API. 5 req/s is polite + well within their
// "don't pound us" guidance.
const sharedRl = new RateLimiter(5);

const defaultFetch = (url) => fetchWithRetry(url);

// ─── Resumable state ─────────────────────────────────────────────────────────

/**
 * Checkpoint shape:
 *   { lastYear: number|null, completedMakeIds: number[] }
 *
 * `lastYear` is the most-recently completed year going downward (endYear
 * → startYear). `completedMakeIds` tracks per-year progress for the
 * currently-in-flight year.
 */
export async function resumeState(checkpointPath) {
  const empty = { completedMakeIds: [], lastYear: null };
  try {
    const raw = await readFile(checkpointPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      completedMakeIds: Array.isArray(parsed.completedMakeIds)
        ? parsed.completedMakeIds
        : [],
      lastYear: typeof parsed.lastYear === "number" ? parsed.lastYear : null,
    };
  } catch {
    return { ...empty };
  }
}

export async function saveCheckpoint(checkpointPath, state) {
  await writeJsonAtomic(checkpointPath, state);
}

// ─── Slug + era helpers ──────────────────────────────────────────────────────

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Era derivation matching the project's Era union in src/lib/types/cars.ts.
 *   <1946  → pre-war
 *   1946-1964 → post-war-classic
 *   1965-1972 → muscle-era
 *   1973-1983 → malaise
 *   1984-1999 → modern-classic
 *   ≥2000     → modern-collectible
 */
export function eraForYear(year) {
  if (year < 1946) return "pre-war";
  if (year <= 1964) return "post-war-classic";
  if (year <= 1972) return "muscle-era";
  if (year <= 1983) return "malaise";
  if (year <= 1999) return "modern-classic";
  return "modern-collectible";
}

// ─── NHTSA: makes ────────────────────────────────────────────────────────────

/**
 * Fetch all NHTSA passenger-car makes (vehicle type = "car"). Returns:
 *   [{ id: number, display: string }]
 */
export async function fetchMakes({
  fetch: fetchFn = defaultFetch,
  rateLimiter: rl = sharedRl,
} = {}) {
  await rl.take();
  const url =
    "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car?format=json";
  const resp = await fetchFn(url);
  if (!resp.ok) {
    throw new Error(`NHTSA GetMakesForVehicleType failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return (data.Results ?? []).map((m) => ({
    id: m.MakeId,
    display: m.MakeName,
  }));
}

// ─── NHTSA: models for (makeId, year) ────────────────────────────────────────

/**
 * Fetch models for a make + year. Uses the Id-based endpoint to avoid
 * NHTSA's substring matching on the name-based endpoint. Returns:
 *   [{ modelId: number, modelName: string, makeId: number, makeName: string }]
 */
export async function fetchModelsForMakeYear(
  makeId,
  year,
  { fetch: fetchFn = defaultFetch, rateLimiter: rl = sharedRl } = {}
) {
  await rl.take();
  const url =
    `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeIdYear` +
    `/makeId/${encodeURIComponent(makeId)}/modelyear/${year}?format=json`;
  const resp = await fetchFn(url);
  if (!resp.ok) {
    throw new Error(
      `NHTSA GetModelsForMakeIdYear ${makeId}/${year} failed: HTTP ${resp.status}`
    );
  }
  const data = await resp.json();
  return (data.Results ?? []).map((r) => ({
    modelId: r.Model_ID,
    modelName: r.Model_Name,
    makeId: r.Make_ID,
    makeName: r.Make_Name,
  }));
}

// ─── Row builder ─────────────────────────────────────────────────────────────

/**
 * Build a BulkCatalogRow from an NHTSA model record. Honesty rule: every
 * field NHTSA does not provide is left `null` — never invented.
 */
export function buildRow({ year, make, model }) {
  const slug = slugify(`${year}-${make.display}-${model.modelName}`);
  return {
    slug,
    year,
    make: make.display,
    makeDisplay: make.display,
    model: model.modelName,
    trim: null,
    bodyStyle: null,
    engineDisplacementCc: null,
    cylinders: null,
    fuel: null,
    transmission: null,
    driveType: null,
    countryOfOrigin: null,
    productionStartYear: null,
    productionEndYear: null,
    segment: null,
    era: eraForYear(year),
    isConvertible: null,
    nhtsaId: String(model.modelId),
    nhtsaModelName: model.modelName,
    carqueryId: null,
    source: "nhtsa",
    catalogConfidence: "low",
  };
}

// ─── Confidence scoring ──────────────────────────────────────────────────────

/**
 * Score row confidence by independent source confirmations:
 *   nhtsaId    → 1pt (always present here, since NHTSA is the source)
 *   carapiId   → +1pt
 *   carqueryId → +1pt (only when CARQUERY_ENABLED=1 successfully filled it)
 *   3 → high | 2 → medium | ≤1 → low
 */
export function scoreConfidence(row) {
  let pts = 0;
  if (row.nhtsaId) pts++;
  if (row.carapiId) pts++;
  if (row.carqueryId) pts++;
  if (pts >= 3) return "high";
  if (pts === 2) return "medium";
  return "low";
}

// ─── Main ingest loop ────────────────────────────────────────────────────────

/**
 * @param {{
 *   startYear: number,
 *   endYear: number,
 *   checkpointPath: string,
 *   outputPath: string,
 *   fetch?: Function,
 *   rateLimiter?: object,
 *   dryRun?: boolean,
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
  const ingestStart = Date.now();
  const state = await resumeState(checkpointPath);

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

  // Load existing output so resumed runs preserve already-collected rows.
  let existingRows = [];
  try {
    const raw = await readFile(outputPath, "utf8");
    const parsed = JSON.parse(raw);
    existingRows = Array.isArray(parsed) ? parsed : [];
  } catch {
    /* fresh run */
  }
  const allRows = [...existingRows];

  // Makes are stable across years — fetch once.
  const makesStart = Date.now();
  const makes = await fetchMakes({ fetch: fetchFn, rateLimiter: rl });
  jsonLog({
    operation: "nhtsa.makes",
    durationMs: Date.now() - makesStart,
    recordsProcessed: makes.length,
  });

  let totalApiCalls = 1; // fetchMakes
  const failures = [];

  for (let year = endYear; year >= startYear; year--) {
    if (state.lastYear !== null && year >= state.lastYear) continue;

    const yearStart = Date.now();
    jsonLog({ operation: "year.start", year, makesToProcess: makes.length });

    let yearRowCount = 0;
    let consecutiveFailures = 0;
    for (const make of makes) {
      if (state.completedMakeIds.includes(make.id)) continue;

      try {
        const models = await fetchModelsForMakeYear(make.id, year, {
          fetch: fetchFn,
          rateLimiter: rl,
        });
        totalApiCalls++;
        for (const model of models) {
          allRows.push(buildRow({ year, make, model }));
          yearRowCount++;
        }
        consecutiveFailures = 0;
        state.completedMakeIds.push(make.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonLog({
          operation: "nhtsa.models.fail",
          year,
          makeId: make.id,
          makeDisplay: make.display,
          error: msg,
        });
        failures.push({ year, makeId: make.id, make: make.display, error: msg });
        consecutiveFailures++;
        if (consecutiveFailures > 5) {
          // Flush what we have before propagating so the resume-checkpoint
          // is consistent with the on-disk file.
          const flush = dedupeBySlug(allRows);
          await writeJsonAtomic(outputPath, flush);
          await saveCheckpoint(checkpointPath, state);
          throw new Error(
            `aborting: >5 consecutive NHTSA failures (last: ${msg})`
          );
        }
        // Failed makes are NOT added to completedMakeIds, so a resume
        // will retry them.
      }
    }

    // Per-year flush (crash-safety): dedupe by slug, sort, atomic write,
    // THEN advance lastYear. If we crash before advancing, the year will
    // be re-processed but the file already has the data so the union is
    // safe (next run will dedupe again).
    const dedupedFlush = dedupeBySlug(allRows);
    await writeJsonAtomic(outputPath, dedupedFlush);

    state.completedMakeIds = [];
    state.lastYear = year;
    await saveCheckpoint(checkpointPath, state);

    jsonLog({
      operation: "year.done",
      year,
      durationMs: Date.now() - yearStart,
      recordsProcessed: yearRowCount,
      cumulative: dedupedFlush.length,
    });
  }

  // Optional CarAPI enrichment.
  if (process.env.CARAPI_KEY) {
    try {
      const { getCarApiToken, enrichWithCarApi } = await import(
        "./_lib/carapi.mjs"
      );
      const token = await getCarApiToken({
        fetch: fetchFn,
        jwt: process.env.CARAPI_KEY,
      });
      await enrichWithCarApi(allRows, {
        fetch: fetchFn,
        rateLimiter: rl,
        token,
      });
      jsonLog({ operation: "carapi.enrich.done" });
    } catch (err) {
      jsonLog({
        operation: "carapi.enrich.fail",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    jsonLog({ operation: "carapi.skip", reason: "no_key" });
  }

  // Optional legacy CarQuery augment — host is dead so default OFF.
  if (process.env.CARQUERY_ENABLED === "1") {
    jsonLog({
      operation: "carquery.skip",
      reason: "host_dead_legacyarcade_cert",
      note: "CarQuery host serves legacyarcade.com cert + 400 from ELB",
    });
  }

  // Final dedupe + sort + confidence scoring.
  const sorted = dedupeBySlug(allRows);
  for (const row of sorted) {
    row.catalogConfidence = scoreConfidence(row);
  }
  await writeJsonAtomic(outputPath, sorted);

  jsonLog({
    operation: "ingest.complete",
    durationMs: Date.now() - ingestStart,
    recordsProcessed: sorted.length,
    makesProcessed: makes.length,
    apiCalls: totalApiCalls,
    failures: failures.length,
  });

  return sorted;
}

/** Dedupe by slug — keep first occurrence (preserves resumed-run rows). */
function dedupeBySlug(rows) {
  const seen = new Map();
  for (const r of rows) {
    if (!seen.has(r.slug)) seen.set(r.slug, r);
  }
  return [...seen.values()].sort((a, b) => a.slug.localeCompare(b.slug));
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
