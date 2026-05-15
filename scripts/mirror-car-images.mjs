#!/usr/bin/env node
/**
 * mirror-car-images.mjs  (Phase E — tiered cache + attribution + fallback + image_status)
 *
 * For every catalog vehicle:
 *   1. Route through DynamoDB tiered cache (pk=image#<slug>, 30d TTL).
 *   2. On cache miss: query Wikimedia Commons for a full-vehicle image.
 *   3. Attribution (author + license + licenseUrl) is ALWAYS persisted — legally required.
 *   4. Fallback chain: Wikimedia → OldCarsData auction imageUrl → "missing"
 *   5. Emit imageStatus:"missing" for vehicles with no image (feeds Phase H report).
 *
 * CLI: node scripts/mirror-car-images.mjs
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const IMAGES_JSON = resolve(ROOT, "src/lib/data/cars-ml/oldcarsdata-auction-images.json");
const PRICES_JSON = resolve(ROOT, "src/lib/data/cars-ml/oldcarsdata-current-prices.json");
const MISSING_JSON = resolve(ROOT, "src/lib/data/cars-ml/missing-images.json");
const OUT_DIR = resolve(ROOT, "public/cars");

const UA = "CarClubFuture/1.0 (https://carclubfuture.com; hello@carclubfuture.com) Node/22";
const SLOW_RETRY = { delaysMs: [1500, 4000, 9000] };

// 1 req/s for Wikimedia (polite rate; search + bytes share the bucket)
const limiter = new RateLimiter(1);

// ---------------------------------------------------------------------------
// Pure image-selection logic — exported for unit tests (Task E4)
// ---------------------------------------------------------------------------

/**
 * Determine which VehicleImage to use for a vehicle, given:
 *   - wikimediaCandidates: raw results from searchVehicleImages (may be [])
 *   - oldcarsdataRecord: the OldCarsData price record for this slug (may be null)
 *   - slug: vehicle slug
 *   - cachedAt: ISO timestamp for the cachedAt field (defaults to now)
 *
 * Returns a VehicleImage-shaped object (matches src/lib/types/cars.ts).
 * Attribution fields are NEVER null/undefined.
 *
 * @param {object} opts
 * @param {Array}  opts.wikimediaCandidates
 * @param {object|null} opts.oldcarsdataRecord
 * @param {string} opts.slug
 * @param {string} [opts.cachedAt]
 * @returns {object}  VehicleImage
 */
export function selectImageForVehicle({ wikimediaCandidates = [], oldcarsdataRecord = null, slug, cachedAt }) {
  const now = cachedAt || new Date().toISOString();

  // ── Wikimedia (preferred) ─────────────────────────────────────────────────
  const best = pickBestImage(wikimediaCandidates);
  if (best) {
    return {
      slug,
      url: best.url,
      width: best.width ?? null,
      height: best.height ?? null,
      source: "wikimedia",
      attribution: {
        author: best.author || "Unknown",
        license: best.license || "Unknown",
        licenseUrl: best.licenseUrl || "",
      },
      imageStatus: "ok",
      cachedAt: now,
    };
  }

  // ── OldCarsData auction fallback ──────────────────────────────────────────
  if (oldcarsdataRecord?.imageUrl) {
    return {
      slug,
      url: oldcarsdataRecord.imageUrl,
      width: null,
      height: null,
      source: "oldcarsdata",
      attribution: {
        author: "OldCarsData / BringATrailer auction listing",
        license: "Editorial use",
        licenseUrl: "",
      },
      imageStatus: "ok",
      cachedAt: now,
    };
  }

  // ── Missing ───────────────────────────────────────────────────────────────
  return {
    slug,
    url: "",
    width: null,
    height: null,
    source: "missing",
    attribution: {
      author: "Unknown",
      license: "Unknown",
      licenseUrl: "",
    },
    imageStatus: "missing",
    cachedAt: now,
  };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function exists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function mirrorBytes(url, dest) {
  // Rate-limit: 1 req/s shared with search calls
  await limiter.take();
  const r = await fetchWithRetry(url, { headers: { "User-Agent": UA } }, SLOW_RETRY);
  if (!r.ok) throw new Error(`mirror bytes HTTP ${r.status}: ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(dest, buf);
  const st = await stat(dest);
  return st.size;
}

// ---------------------------------------------------------------------------
// Per-vehicle origin fetch (called by withCache on L3 miss)
// ---------------------------------------------------------------------------

/**
 * Fetch Wikimedia image, mirror bytes, build a VehicleImage record.
 * Falls back through OldCarsData → "missing" before returning.
 *
 * @param {string} slug
 * @param {object} car           Catalog entry { year, make, model, ... }
 * @param {object} pricesIndex   Map of slug → OldCarsData price record
 * @param {object} existingImages  Existing auction-images.json map (for local file check)
 * @returns {Promise<object>}    VehicleImage
 */
async function fetchAndPickImage(slug, car, pricesIndex, existingImages) {
  const cachedAt = new Date().toISOString();

  // --- Wikimedia search ---
  let wikimediaCandidates = [];
  try {
    wikimediaCandidates = await searchVehicleImages({
      year: car.year,
      make: car.make,
      model: car.model,
      fetch: (url, init) => fetchWithRetry(url, init),
      rateLimiter: limiter,
    });
  } catch (err) {
    jsonLog({ operation: "wikimedia.search.error", slug, error: err });
  }

  const vehicleImage = selectImageForVehicle({
    wikimediaCandidates,
    oldcarsdataRecord: pricesIndex[slug] ?? null,
    slug,
    cachedAt,
  });

  // --- Mirror bytes for Wikimedia images (side effect, best-effort) ---
  if (vehicleImage.source === "wikimedia" && vehicleImage.url) {
    try {
      await mkdir(OUT_DIR, { recursive: true });
      const imgUrl = vehicleImage.url;
      const ext = (extname(new URL(imgUrl).pathname) || ".jpg").toLowerCase();
      const dest = resolve(OUT_DIR, `${slug}${ext}`);
      if (!(await exists(dest))) {
        const bytes = await mirrorBytes(imgUrl, dest);
        jsonLog({ operation: "wikimedia.bytes.mirrored", slug, bytes, dest });
        // Update url to local path (same convention as legacy script)
        vehicleImage.url = `/cars/${slug}${ext}`;
      } else {
        // Reuse existing local path from existing record if available
        const existing = existingImages[slug];
        if (existing?.url && existing.url.startsWith("/cars/")) {
          vehicleImage.url = existing.url;
        } else {
          vehicleImage.url = `/cars/${slug}${ext}`;
        }
      }
    } catch (mirrorErr) {
      // Byte mirroring failure is non-fatal — use original Wikimedia URL
      jsonLog({ operation: "wikimedia.bytes.error", slug, error: mirrorErr });
    }
  }

  return vehicleImage;
}

// ---------------------------------------------------------------------------
// Build the per-slug JSON record (extend legacy format, add new fields)
// ---------------------------------------------------------------------------

/**
 * Merge a VehicleImage into the legacy auction-images.json entry format.
 * Preserves all keys the UI already reads (url, source, sourcePageUrl,
 * license, author, mirroredAt) while adding imageStatus, cachedAt,
 * licenseUrl, width, height.
 */
function buildJsonRecord(vehicleImage, existingEntry) {
  const { attribution } = vehicleImage;
  return {
    // Legacy fields (UI reads these)
    url: vehicleImage.url,
    source: vehicleImage.source,
    sourcePageUrl: existingEntry?.sourcePageUrl ?? "",
    license: attribution.license,
    author: attribution.author,
    mirroredAt: existingEntry?.mirroredAt ?? vehicleImage.cachedAt,
    // New fields (Phase E)
    licenseUrl: attribution.licenseUrl,
    width: vehicleImage.width,
    height: vehicleImage.height,
    imageStatus: vehicleImage.imageStatus,
    cachedAt: vehicleImage.cachedAt,
  };
}

// ---------------------------------------------------------------------------
// Load bundled fallback from existing JSON (used by withCache L2)
// ---------------------------------------------------------------------------

/** @type {Record<string, object>|null} */
let _bundledImages = null;

async function loadBundledImages() {
  if (_bundledImages) return _bundledImages;
  if (await exists(IMAGES_JSON)) {
    try {
      _bundledImages = JSON.parse(await readFile(IMAGES_JSON, "utf8"));
    } catch {
      _bundledImages = {};
    }
  } else {
    _bundledImages = {};
  }
  return _bundledImages;
}

/**
 * Return the bundled VehicleImage for a slug (from existing JSON), or null.
 * Converts the legacy flat record to a VehicleImage-shaped object.
 */
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
    attribution: {
      author: r.author ?? "Unknown",
      license: r.license ?? "Unknown",
      licenseUrl: r.licenseUrl ?? r.sourcePageUrl ?? "",
    },
    imageStatus: r.imageStatus ?? "ok",
    cachedAt: r.cachedAt ?? r.mirroredAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  const cars = Array.isArray(catalogFile) ? catalogFile : (catalogFile.vehicles ?? []);

  const pricesFile = JSON.parse(await readFile(PRICES_JSON, "utf8"));
  /** @type {Record<string, object>} */
  const pricesIndex = pricesFile.prices ?? pricesFile ?? {};

  // Load existing images JSON (will be updated in place)
  const existingImages = (await loadBundledImages()) ?? {};

  const result = await timed("mirror:images", async () => {
    let ok = 0, missing = 0, cached = 0;

    /** @type {Record<string, object>} Accumulated image records */
    const updatedImages = { ...existingImages };

    for (const car of cars) {
      const slug = car.slug;

      const cacheResult = await withCache({
        pk: `image#${slug}`,
        sk: "v1",
        ttlSeconds: 30 * 24 * 3600, // 30-day TTL per plan
        source: "wikimedia",
        bundledFallback: () => loadBundledImage(slug),
        fetchOrigin: () => fetchAndPickImage(slug, car, pricesIndex, existingImages),
      });

      const vehicleImage = cacheResult.value;

      jsonLog({
        operation: "image.mirror",
        slug,
        cache_layer: cacheResult.layer,
        image_status: vehicleImage?.imageStatus,
        source: vehicleImage?.source,
        durationMs: cacheResult.durationMs,
      });

      if (vehicleImage) {
        updatedImages[slug] = buildJsonRecord(vehicleImage, existingImages[slug]);
        if (vehicleImage.imageStatus === "missing") {
          missing++;
        } else {
          ok++;
        }
        if (cacheResult.layer === "L0" || cacheResult.layer === "L1" || cacheResult.layer === "L2") {
          cached++;
        }
      }
    }

    // Atomic write: updated images JSON (L2 bundled fallback)
    await writeJsonAtomic(IMAGES_JSON, updatedImages);

    // Write missing-images.json (Phase H limitations report)
    const missingSlugs = Object.entries(updatedImages)
      .filter(([, v]) => v.imageStatus === "missing")
      .map(([slug]) => slug);
    await writeJsonAtomic(MISSING_JSON, {
      generatedAt: new Date().toISOString(),
      slugs: missingSlugs,
    });

    jsonLog({ operation: "mirror:images.missing", count: missingSlugs.length, slugs: missingSlugs });

    return { recordsProcessed: cars.length, ok, missing, cached };
  });

  jsonLog({ operation: "mirror:images.summary", ...result });
}

// Only run main() when executed directly (not when imported by tests)
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    jsonLog({ operation: "mirror:images.fatal", error: err });
    process.exit(1);
  });
}
