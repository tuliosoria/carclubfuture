/**
 * Bulk catalog ingest — NHTSA-primary.
 *
 * Cars-only: uses the vehicleType-scoped model endpoint so motorcycle
 * models never enter the catalog. Makes are the union of NHTSA's "car"
 * and "passenger car" vehicle-type lists MINUS makes that ONLY appear
 * under "motorcycle" (cuts ~14k motorcycle rows from prior ingests).
 *
 * NHTSA does NOT return engine, body style, transmission, or drive —
 * those fields stay `null` (honesty rule) unless enrichment fills them.
 *
 * Pipeline:
 *   1. fetchMakes()           → union(car, passenger car) − moto-only
 *   2. fetchModelsForMakeYear → cars-only models for every (make, year)
 *   3. emit BulkCatalogRow per (year, make, model) with derived `era`
 *   4. per-year incremental flush → checkpoint + atomic output write
 *   5. optional CarAPI enrichment behind CARAPI_KEY env var
 *
 * Optional flags (default OFF — this pass is cars-only):
 *   --include-suvs    also ingest "Multipurpose Passenger Vehicle (MPV)"
 *   --include-trucks  also ingest "truck"
 *
 * CLI:
 *   node scripts/ingest-cars-catalog-bulk.mjs \
 *     --start-year=1950 --end-year=2024 \
 *     --output=src/lib/data/cars-ml/cars-catalog-bulk.json \
 *     --checkpoint=scripts/output/ingest-checkpoint.json \
 *     [--dry-run] [--include-suvs] [--include-trucks]
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
 * Acronym makes that NHTSA returns ALL-CAPS but are properly displayed
 * in caps. Title-casing them would produce e.g. "Bmw" / "Gmc" — wrong.
 * Conservative list — only obvious all-caps brands.
 */
const ACRONYM_MAKES = new Set([
  "BMW",
  "GMC",
  "AMC",
  "MG",
  "GAZ",
  "ZAZ",
  "AC",
  "ARO",
  "RUF",
  "FSO",
  "IKA",
  "MGB",
  "SAAB",
  "BYD",
  "FIAT",
  "SEAT",
  "DAF",
  "DKW",
  "BSA",
  "TVR",
  "VAZ",
  "UAZ",
  "MAN",
  "REO",
  "GAC",
  "JAC",
  "MCC",
  "BMC",
  "DS",
  "SRT",
  "BAC",
  "BAW",
  "MAZ",
  "KTM",
  "VW",
]);

/** Title-case a SHOUTY NHTSA make/model name, but preserve known acronyms. */
function titleCaseMake(s) {
  if (!s) return s;
  const upper = s.trim().toUpperCase();
  if (ACRONYM_MAKES.has(upper)) return upper;
  return s
    .toLowerCase()
    .split(/(\s|-|\/)/)
    .map((tok) =>
      /^[a-z]/.test(tok) ? tok[0].toUpperCase() + tok.slice(1) : tok
    )
    .join("");
}

/**
 * Fetch makes for a given NHTSA vehicleType label. Returns:
 *   [{ id: number, display: string }]
 */
async function fetchMakesForType(typeLabel, { fetch: fetchFn, rateLimiter: rl }) {
  await rl.take();
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/${encodeURIComponent(typeLabel)}?format=json`;
  const resp = await fetchFn(url);
  if (!resp.ok) {
    throw new Error(
      `NHTSA GetMakesForVehicleType(${typeLabel}) failed: HTTP ${resp.status}`
    );
  }
  const data = await resp.json();
  return (data.Results ?? []).map((m) => ({
    id: m.MakeId,
    display: m.MakeName,
  }));
}

/**
 * Fetch all NHTSA passenger-car makes — union of "car" and "passenger car"
 * vehicle types, minus makes that ONLY appear in the "motorcycle" list.
 * Returns:
 *   [{ id: number, display: string }]
 *
 * Extra vehicle types (MPV, truck) are unioned in only when their flag is set.
 */
export async function fetchMakes({
  fetch: fetchFn = defaultFetch,
  rateLimiter: rl = sharedRl,
  includeSuvs = false,
  includeTrucks = false,
} = {}) {
  const types = ["car", "passenger car"];
  if (includeSuvs) types.push("Multipurpose Passenger Vehicle (MPV)");
  if (includeTrucks) types.push("truck");

  // Union of all car-ish makes
  const byId = new Map();
  for (const t of types) {
    const ms = await fetchMakesForType(t, { fetch: fetchFn, rateLimiter: rl });
    for (const m of ms) {
      if (!byId.has(m.id)) byId.set(m.id, m);
    }
  }

  // Cross-reference motorcycle list
  let motorcycleMakeIds = new Set();
  try {
    const motos = await fetchMakesForType("motorcycle", {
      fetch: fetchFn,
      rateLimiter: rl,
    });
    motorcycleMakeIds = new Set(motos.map((m) => m.id));
  } catch (err) {
    jsonLog({
      operation: "nhtsa.motorcycle.fetch.fail",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Drop makes that are motorcycle-only (in moto list AND not in car list).
  // Because byId is already the car/passenger-car union, a make that is in
  // motorcycleMakeIds but ALSO in byId is dual-use (Honda, BMW, Suzuki) and
  // we keep it — the cars-only model endpoint filters its bikes out.
  // Motorcycle-only makes are simply not in byId, so no extra subtraction
  // needed — but log the count of motorcycle-only makes we avoided fetching.
  const dualUse = [...byId.keys()].filter((id) => motorcycleMakeIds.has(id));
  const motoOnly = [...motorcycleMakeIds].filter((id) => !byId.has(id));
  jsonLog({
    operation: "nhtsa.makes.union",
    carMakes: byId.size,
    motorcycleMakes: motorcycleMakeIds.size,
    dualUseMakes: dualUse.length,
    motorcycleOnlySkipped: motoOnly.length,
  });

  return [...byId.values()];
}

// ─── NHTSA: models for (makeName, year) ──────────────────────────────────────

/**
 * Fetch CAR models for a make + year. Uses the vehicleType-scoped endpoint
 * so motorcycles never appear in results. NHTSA only exposes this endpoint
 * via make NAME (not Id). Returns:
 *   [{ modelId: number, modelName: string, makeId: number, makeName: string }]
 */
export async function fetchModelsForMakeYear(
  makeOrId,
  year,
  { fetch: fetchFn = defaultFetch, rateLimiter: rl = sharedRl, vehicleType = "car" } = {}
) {
  // Accept either a make object {id, display} or a raw makeName string for
  // backwards compatibility with older tests.
  const makeName = typeof makeOrId === "object" ? makeOrId.display : String(makeOrId);
  const makeIdFallback = typeof makeOrId === "object" ? makeOrId.id : null;

  await rl.take();
  const url =
    `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear` +
    `/make/${encodeURIComponent(makeName)}` +
    `/modelyear/${year}` +
    `/vehicletype/${encodeURIComponent(vehicleType)}?format=json`;
  const resp = await fetchFn(url);
  if (!resp.ok) {
    throw new Error(
      `NHTSA GetModelsForMakeYear ${makeName}/${year}/${vehicleType} failed: HTTP ${resp.status}`
    );
  }
  const data = await resp.json();
  return (data.Results ?? []).map((r) => ({
    modelId: r.Model_ID,
    modelName: r.Model_Name,
    makeId: r.Make_ID ?? makeIdFallback,
    makeName: r.Make_Name ?? makeName,
  }));
}

// ─── Row builder ─────────────────────────────────────────────────────────────

/**
 * Build a BulkCatalogRow from an NHTSA model record. Honesty rule: every
 * field NHTSA does not provide is left `null` — never invented.
 *
 * `makeDisplay` is the properly-cased presentation form (acronyms preserved,
 * everything else Title Cased). `make` is the raw NHTSA value.
 */
export function buildRow({ year, make, model }) {
  const properMake = titleCaseMake(make.display);
  const slug = slugify(`${year}-${properMake}-${model.modelName}`);
  return {
    slug,
    year,
    make: make.display,
    makeDisplay: properMake,
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
  includeSuvs = false,
  includeTrucks = false,
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
  const makes = await fetchMakes({
    fetch: fetchFn,
    rateLimiter: rl,
    includeSuvs,
    includeTrucks,
  });
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
        const models = await fetchModelsForMakeYear(make, year, {
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
  const includeSuvs = args["include-suvs"] === true || args["include-suvs"] === "true";
  const includeTrucks = args["include-trucks"] === true || args["include-trucks"] === "true";

  ingest({
    startYear,
    endYear,
    checkpointPath,
    outputPath,
    dryRun,
    includeSuvs,
    includeTrucks,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
