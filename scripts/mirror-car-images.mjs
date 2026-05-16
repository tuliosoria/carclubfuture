#!/usr/bin/env node
/**
 * mirror-car-images.mjs  (Phase E + Wikipedia pageimages fallback)
 *
 * For every catalog vehicle:
 *   1. Wikimedia Commons full-vehicle search   (primary, ~1 req/s)
 *   2. Wikipedia pageimages article fallback   (secondary, ~1 req/s)
 *   3. OldCarsData auction imageUrl            (legacy fallback)
 *   4. "missing"                               (cohort report only)
 *
 * Attribution (author + license + sourcePageUrl) is ALWAYS persisted —
 * legally required when displaying the image.
 *
 * Runtime characteristics:
 *   - Idempotent: skips slugs whose existing record has imageStatus:"ok"
 *   - Restart-safe: atomic .tmp+rename of the bundled JSON every 100 cars
 *   - DynamoDB optional: if no creds / table, L1 writes silently skipped
 *
 * CLI flags (all optional):
 *   --catalog=<path>      cars-catalog.json
 *   --output=<path>       oldcarsdata-auction-images.json
 *   --missing-out=<path>  missing-images.json
 *   --coverage=<path>     coverage report JSON
 *   --limit=<n>           process only first n catalog entries (for testing)
 *   --force               re-process even when existing record is "ok"
 */
import { readFile, writeFile, mkdir, access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, extname } from "node:path";

import { fetchWithRetry, RateLimiter, writeJsonAtomic, jsonLog, timed } from "./_lib/http.mjs";
import { withCache } from "./_lib/cache.mjs";
import {
  searchVehicleImages,
  pickBestImage,
  extractAttribution,
} from "./_lib/wikimedia.mjs";
import { fetchWikipediaImage } from "./_lib/wikipedia.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ARGS = parseArgs(process.argv.slice(2));

const CATALOG       = ARGS.catalog      ?? resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const IMAGES_JSON   = ARGS.output       ?? resolve(ROOT, "src/lib/data/cars-ml/oldcarsdata-auction-images.json");
const PRICES_JSON   = ARGS.prices       ?? resolve(ROOT, "src/lib/data/cars-ml/oldcarsdata-current-prices.json");
const MISSING_JSON  = ARGS["missing-out"] ?? resolve(ROOT, "src/lib/data/cars-ml/missing-images.json");
const COVERAGE_JSON = ARGS.coverage     ?? resolve(ROOT, "scripts/output/image-coverage-report.json");
const OUT_DIR       = resolve(ROOT, "public/cars");

const FORCE = !!ARGS.force;
const LIMIT = ARGS.limit ? parseInt(ARGS.limit, 10) : null;
const FLUSH_EVERY = 100;

const UA = "CarClubFuture/1.0 (https://carclubfuture.com; hello@carclubfuture.com) Node/22";
const SLOW_RETRY = { delaysMs: [1500, 4000, 9000] };

// 1 req/s — polite throttle for each upstream
const wikimediaLimiter = new RateLimiter(1);
const wikipediaLimiter = new RateLimiter(1);

// Whether DDB L1 is reachable; flipped to false on first write failure.
let ddbEnabled = !!(process.env.DYNAMODB_TABLE || process.env.AWS_ACCESS_KEY_ID);

// HTTP request counters (incremented at call sites)
const counters = {
  wikimediaRequests: 0,
  wikipediaRequests: 0,
  bytesMirrored: 0,
};

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pure selection — extended with optional wikipediaResult (single record)
// Backward-compatible with existing tests: wikipediaResult is optional.
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {Array}  opts.wikimediaCandidates
 * @param {object|null} [opts.wikipediaResult]  Result from fetchWikipediaImage, or null
 * @param {object|null} opts.oldcarsdataRecord
 * @param {string} opts.slug
 * @param {string} [opts.cachedAt]
 * @returns {object} VehicleImage
 */
export function selectImageForVehicle({
  wikimediaCandidates = [],
  wikipediaResult = null,
  oldcarsdataRecord = null,
  slug,
  cachedAt,
}) {
  const now = cachedAt || new Date().toISOString();

  // ── Wikimedia (preferred) ───────────────────────────────────────────────
  const best = pickBestImage(wikimediaCandidates);
  if (best) {
    return {
      slug,
      url: best.url,
      width: best.width ?? null,
      height: best.height ?? null,
      source: "wikimedia",
      sourcePageUrl: titleToCommonsUrl(best.title),
      attribution: {
        author: best.author || "Unknown",
        license: best.license || "Unknown",
        licenseUrl: best.licenseUrl || "",
      },
      imageStatus: "ok",
      cachedAt: now,
    };
  }

  // ── Wikipedia pageimages (secondary) ────────────────────────────────────
  if (wikipediaResult?.url) {
    return {
      slug,
      url: wikipediaResult.url,
      width: wikipediaResult.width ?? null,
      height: wikipediaResult.height ?? null,
      source: "wikipedia",
      sourcePageUrl: wikipediaResult.sourcePageUrl || "",
      attribution: {
        author: wikipediaResult.author || "Wikipedia contributors",
        license: wikipediaResult.license || "CC BY-SA 3.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
      },
      imageStatus: "ok",
      cachedAt: now,
    };
  }

  // ── OldCarsData auction fallback ────────────────────────────────────────
  if (oldcarsdataRecord?.imageUrl) {
    return {
      slug,
      url: oldcarsdataRecord.imageUrl,
      width: null,
      height: null,
      source: "oldcarsdata",
      sourcePageUrl: "",
      attribution: {
        author: "OldCarsData / BringATrailer auction listing",
        license: "Editorial use",
        licenseUrl: "",
      },
      imageStatus: "ok",
      cachedAt: now,
    };
  }

  // ── Missing ─────────────────────────────────────────────────────────────
  return {
    slug,
    url: "",
    width: null,
    height: null,
    source: "missing",
    sourcePageUrl: "",
    attribution: {
      author: "Unknown",
      license: "Unknown",
      licenseUrl: "",
    },
    imageStatus: "missing",
    cachedAt: now,
  };
}

function titleToCommonsUrl(title) {
  if (!title) return "";
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function exists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function mirrorBytes(url, dest) {
  await wikimediaLimiter.take();
  counters.wikimediaRequests++;
  const r = await fetchWithRetry(url, { headers: { "User-Agent": UA } }, SLOW_RETRY);
  if (!r.ok) throw new Error(`mirror bytes HTTP ${r.status}: ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(dest, buf);
  const st = await stat(dest);
  counters.bytesMirrored += st.size;
  return st.size;
}

// ---------------------------------------------------------------------------
// Per-vehicle origin fetch
// ---------------------------------------------------------------------------

async function fetchAndPickImage(slug, car, pricesIndex, existingImages) {
  const cachedAt = new Date().toISOString();

  // 1) Wikimedia search
  let wikimediaCandidates = [];
  try {
    const wrapFetch = async (url, init) => {
      counters.wikimediaRequests++;
      return fetchWithRetry(url, init);
    };
    wikimediaCandidates = await searchVehicleImages({
      year: car.year,
      make: car.make,
      model: car.model,
      fetch: wrapFetch,
      rateLimiter: wikimediaLimiter,
    });
  } catch (err) {
    jsonLog({ operation: "wikimedia.search.error", slug, error: err });
  }

  // 2) Wikipedia pageimages — only if Wikimedia has no qualifying candidate
  let wikipediaResult = null;
  if (!pickBestImage(wikimediaCandidates)) {
    try {
      const wpFetch = async (url, init) => {
        counters.wikipediaRequests++;
        return fetchWithRetry(url, init);
      };
      wikipediaResult = await fetchWikipediaImage({
        year: car.year,
        make: car.make,
        model: car.model,
        fetch: wpFetch,
        rateLimiter: wikipediaLimiter,
      });
    } catch (err) {
      jsonLog({ operation: "wikipedia.search.error", slug, error: err });
    }
  }

  const vehicleImage = selectImageForVehicle({
    wikimediaCandidates,
    wikipediaResult,
    oldcarsdataRecord: pricesIndex[slug] ?? null,
    slug,
    cachedAt,
  });

  // 3) Mirror Wikimedia bytes locally (Wikipedia images are linked, not mirrored)
  if (vehicleImage.source === "wikimedia" && vehicleImage.url) {
    try {
      await mkdir(OUT_DIR, { recursive: true });
      const imgUrl = vehicleImage.url;
      const ext = (extname(new URL(imgUrl).pathname) || ".jpg").toLowerCase();
      const dest = resolve(OUT_DIR, `${slug}${ext}`);
      if (!(await exists(dest))) {
        const bytes = await mirrorBytes(imgUrl, dest);
        jsonLog({ operation: "wikimedia.bytes.mirrored", slug, bytes });
        vehicleImage.url = `/cars/${slug}${ext}`;
      } else {
        const existing = existingImages[slug];
        vehicleImage.url = existing?.url?.startsWith("/cars/")
          ? existing.url
          : `/cars/${slug}${ext}`;
      }
    } catch (mirrorErr) {
      jsonLog({ operation: "wikimedia.bytes.error", slug, error: mirrorErr });
    }
  }

  return vehicleImage;
}

// ---------------------------------------------------------------------------
// JSON record shape (legacy + new)
// ---------------------------------------------------------------------------

function buildJsonRecord(vehicleImage, existingEntry) {
  const { attribution } = vehicleImage;
  return {
    url: vehicleImage.url,
    source: vehicleImage.source,
    sourcePageUrl: vehicleImage.sourcePageUrl || existingEntry?.sourcePageUrl || "",
    license: attribution.license,
    author: attribution.author,
    mirroredAt: existingEntry?.mirroredAt ?? vehicleImage.cachedAt,
    licenseUrl: attribution.licenseUrl,
    width: vehicleImage.width,
    height: vehicleImage.height,
    imageStatus: vehicleImage.imageStatus,
    cachedAt: vehicleImage.cachedAt,
  };
}

// ---------------------------------------------------------------------------
// Bundled fallback loader (L2)
// ---------------------------------------------------------------------------

let _bundledImages = null;

async function loadBundledImages() {
  if (_bundledImages) return _bundledImages;
  if (await exists(IMAGES_JSON)) {
    try { _bundledImages = JSON.parse(await readFile(IMAGES_JSON, "utf8")); }
    catch { _bundledImages = {}; }
  } else {
    _bundledImages = {};
  }
  return _bundledImages;
}

async function loadBundledImage(slug) {
  const bundled = await loadBundledImages();
  const r = bundled[slug];
  if (!r) return null;
  return {
    slug,
    url: r.url ?? "",
    width: r.width ?? null,
    height: r.height ?? null,
    source: r.source ?? "wikimedia",
    sourcePageUrl: r.sourcePageUrl ?? "",
    attribution: {
      author: r.author ?? "Unknown",
      license: r.license ?? "Unknown",
      licenseUrl: r.licenseUrl ?? "",
    },
    imageStatus: r.imageStatus ?? "ok",
    cachedAt: r.cachedAt ?? r.mirroredAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// DDB-optional wrapper
// ---------------------------------------------------------------------------

async function resolveImage(slug, car, pricesIndex, existingImages) {
  if (!ddbEnabled) {
    // Direct path: no DDB calls. We still honor in-memory bundled fallback
    // so an "ok" record short-circuits (handled by caller's skip logic).
    const value = await fetchAndPickImage(slug, car, pricesIndex, existingImages);
    return { value, layer: "L3", durationMs: 0, source: value.source };
  }
  try {
    return await withCache({
      pk: `image#${slug}`,
      sk: "v1",
      ttlSeconds: 30 * 24 * 3600,
      source: "wikimedia",
      bundledFallback: () => loadBundledImage(slug),
      fetchOrigin: () => fetchAndPickImage(slug, car, pricesIndex, existingImages),
    });
  } catch (err) {
    // First DDB failure → disable L1 for the rest of the run, fall through.
    jsonLog({ operation: "ddb.disabled", reason: err?.message || String(err) });
    ddbEnabled = false;
    const value = await fetchAndPickImage(slug, car, pricesIndex, existingImages);
    return { value, layer: "L3", durationMs: 0, source: value.source };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(dirname(COVERAGE_JSON), { recursive: true });

  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  const carsAll = Array.isArray(catalogFile) ? catalogFile : (catalogFile.vehicles ?? []);
  const cars = LIMIT ? carsAll.slice(0, LIMIT) : carsAll;

  let pricesIndex = {};
  try {
    const pricesFile = JSON.parse(await readFile(PRICES_JSON, "utf8"));
    pricesIndex = pricesFile.prices ?? pricesFile ?? {};
  } catch {
    jsonLog({ operation: "prices.missing", path: PRICES_JSON });
  }

  const existingImages = (await loadBundledImages()) ?? {};

  const startedAt = Date.now();

  const result = await timed("mirror:images", async () => {
    let processed = 0, wikimediaHits = 0, wikipediaHits = 0, oldcarsdataHits = 0, missing = 0;
    let skipped = 0;
    const updatedImages = { ...existingImages };
    let sinceFlush = 0;

    for (const car of cars) {
      const slug = car.slug;
      processed++;

      const existing = updatedImages[slug];
      if (!FORCE && existing && existing.imageStatus === "ok" && existing.url) {
        skipped++;
        if (existing.source === "wikipedia") wikipediaHits++;
        else if (existing.source === "oldcarsdata") oldcarsdataHits++;
        else wikimediaHits++;
        continue;
      }

      let cacheResult;
      try {
        cacheResult = await resolveImage(slug, car, pricesIndex, existingImages);
      } catch (err) {
        jsonLog({ operation: "image.fatal", slug, error: err });
        continue;
      }

      const vehicleImage = cacheResult.value;
      if (!vehicleImage) continue;

      updatedImages[slug] = buildJsonRecord(vehicleImage, existingImages[slug]);

      switch (vehicleImage.source) {
        case "wikimedia":   wikimediaHits++;   break;
        case "wikipedia":   wikipediaHits++;   break;
        case "oldcarsdata": oldcarsdataHits++; break;
        default:            missing++;
      }

      jsonLog({
        operation: "image.mirror",
        slug,
        n: processed,
        of: cars.length,
        source: vehicleImage.source,
        status: vehicleImage.imageStatus,
        wm_reqs: counters.wikimediaRequests,
        wp_reqs: counters.wikipediaRequests,
      });

      sinceFlush++;
      if (sinceFlush >= FLUSH_EVERY) {
        await writeJsonAtomic(IMAGES_JSON, updatedImages);
        sinceFlush = 0;
        jsonLog({
          operation: "checkpoint.flush",
          processed,
          wikimediaHits, wikipediaHits, oldcarsdataHits, missing, skipped,
        });
      }
    }

    // Final flush
    await writeJsonAtomic(IMAGES_JSON, updatedImages);

    // Missing report
    const missingSlugs = Object.entries(updatedImages)
      .filter(([, v]) => v.imageStatus === "missing")
      .map(([slug]) => slug);
    await writeJsonAtomic(MISSING_JSON, {
      generatedAt: new Date().toISOString(),
      slugs: missingSlugs,
    });

    return {
      recordsProcessed: processed,
      ok: wikimediaHits + wikipediaHits + oldcarsdataHits + skipped,
      missing,
      _stats: {
        wikimediaHits, wikipediaHits, oldcarsdataHits, missing, skipped,
        missingSlugs,
      },
    };
  });

  const elapsedMs = Date.now() - startedAt;
  const stats = result._stats;
  const total = cars.length;
  const hits = stats.wikimediaHits + stats.wikipediaHits + stats.oldcarsdataHits + stats.skipped;
  const coverage = total > 0 ? hits / total : 0;

  const summary = {
    generatedAt: new Date().toISOString(),
    elapsedMs,
    elapsedHuman: humanDuration(elapsedMs),
    totalVehicles: total,
    wikimediaHits: stats.wikimediaHits,
    wikipediaHits: stats.wikipediaHits,
    oldcarsdataHits: stats.oldcarsdataHits,
    skippedAlreadyOk: stats.skipped,
    missing: stats.missing,
    totalHits: hits,
    coveragePct: +(coverage * 100).toFixed(2),
    httpRequests: {
      wikimedia: counters.wikimediaRequests,
      wikipedia: counters.wikipediaRequests,
    },
    bytesMirrored: counters.bytesMirrored,
    missingSampleTop20: stats.missingSlugs.slice(0, 20),
  };

  await writeJsonAtomic(COVERAGE_JSON, summary);
  jsonLog({ operation: "mirror:images.summary", ...summary });

  // Human-readable lines for the run log
  process.stdout.write(`\n=== COVERAGE ===\n`);
  process.stdout.write(`Total:          ${total}\n`);
  process.stdout.write(`Wikimedia hits: ${stats.wikimediaHits}\n`);
  process.stdout.write(`Wikipedia hits: ${stats.wikipediaHits}\n`);
  process.stdout.write(`OldCarsData:    ${stats.oldcarsdataHits}\n`);
  process.stdout.write(`Skipped (ok):   ${stats.skipped}\n`);
  process.stdout.write(`Missing:        ${stats.missing}\n`);
  process.stdout.write(`Coverage:       ${summary.coveragePct}%\n`);
  process.stdout.write(`HTTP wikimedia: ${counters.wikimediaRequests}\n`);
  process.stdout.write(`HTTP wikipedia: ${counters.wikipediaRequests}\n`);
  process.stdout.write(`Elapsed:        ${summary.elapsedHuman}\n`);
  process.stdout.write(`Missing sample (top 20):\n${summary.missingSampleTop20.join("\n")}\n`);
}

function humanDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h${m}m${sec}s`;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    jsonLog({ operation: "mirror:images.fatal", error: err });
    process.exit(1);
  });
}
