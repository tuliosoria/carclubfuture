#!/usr/bin/env node
/**
 * build-price-aggregates.mjs — merge OldCarsData + BaT history into
 * 12-month / 36-month aggregate features for the ML model.
 *
 * Usage:
 *   node scripts/build-price-aggregates.mjs --output=src/lib/data/cars-ml/price-aggregates.json
 *
 * Reads:
 *   src/lib/data/cars-ml/oldcarsdata-current-prices.json
 *   src/lib/data/cars-ml/bat-auction-history.json (optional — tolerated missing)
 *   src/lib/data/cars-ml/cars-catalog.json (for full slug list)
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { writeJsonAtomic, jsonLog } from "./_lib/http.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// ── Pure aggregation function (exported for tests) ───────────────────────────

/**
 * Compute median of a sorted (or unsorted) numeric array.
 * Returns null for empty arrays.
 * @param {number[]} values
 * @returns {number | null}
 */
function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Build price aggregates for all slugs.
 *
 * @param {{
 *   oldcarsdataRows: Record<string, object>,   // shape from oldcarsdata-current-prices.json .prices
 *   batHistoryRows:  Record<string, object>,   // shape from bat-auction-history.json
 *   slugs:           string[],                 // full catalog slug list
 *   now?:            Date,
 * }} opts
 * @returns {Record<string, import('../src/lib/types/cars').PriceAggregates>}
 */
export function buildAggregates({ oldcarsdataRows, batHistoryRows, slugs, now = new Date() }) {
  const nowMs     = now.getTime();
  const ms90d     = 90  * 24 * 3600 * 1000;
  const ms12mo    = 365 * 24 * 3600 * 1000;
  const ms36mo    = 3 * 365 * 24 * 3600 * 1000;
  const ms30d     = 30  * 24 * 3600 * 1000;
  const ms60d     = 60  * 24 * 3600 * 1000;
  const ms330d    = 330 * 24 * 3600 * 1000;
  const ms360d    = 360 * 24 * 3600 * 1000;

  const computed_at = now.toISOString();
  const result = {};

  for (const slug of slugs) {
    // ── Collect observations from both sources ─────────────────────────────
    const observations = []; // { soldPriceUsd, soldDate (ms), reserveMet, mileage, source }
    const data_sources = [];

    // OldCarsData row: treat valueUsd as a single recent observation anchored at asOf
    const ocd = (oldcarsdataRows ?? {})[slug];
    if (ocd && typeof ocd.valueUsd === "number") {
      const ts = ocd.asOf ? new Date(ocd.asOf).getTime() : nowMs;
      observations.push({
        soldPriceUsd: ocd.valueUsd,
        soldDateMs: ts,
        reserveMet: ocd.reserveMetRate12mo != null ? ocd.reserveMetRate12mo >= 0.5 : null,
        mileage: null,
        source: "oldcarsdata",
      });
      if (!data_sources.includes("oldcarsdata")) data_sources.push("oldcarsdata");
    }

    // BaT history rows: each result is an individual auction observation
    const bat = (batHistoryRows ?? {})[slug];
    if (bat?.results?.length) {
      for (const r of bat.results) {
        if (typeof r.soldPriceUsd !== "number") continue;
        const ts = r.soldDate ? new Date(r.soldDate).getTime() : null;
        if (!ts || isNaN(ts)) continue;
        observations.push({
          soldPriceUsd: r.soldPriceUsd,
          soldDateMs: ts,
          reserveMet: r.reserveMet ?? null,
          mileage: r.mileage ?? null,
          source: "bat",
        });
      }
      if (!data_sources.includes("bat")) data_sources.push("bat");
    }

    // ── Deduplicate (best-effort: by price+date proximity; no shared listingUrl cross-source) ─
    // Simple dedup: exact soldPriceUsd + same day
    const seen = new Set();
    const deduped = observations.filter((o) => {
      const key = `${o.soldPriceUsd}_${o.soldDateMs}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // ── Time-window helpers ────────────────────────────────────────────────
    const inWindow = (obs, maxAgeMs) =>
      deduped.filter((o) => nowMs - o.soldDateMs <= maxAgeMs);

    const obs90d   = inWindow(deduped, ms90d);
    const obs12mo  = inWindow(deduped, ms12mo);
    const obs36mo  = inWindow(deduped, ms36mo);

    // Momentum windows
    const obs30d        = deduped.filter((o) => nowMs - o.soldDateMs <= ms30d);
    const obs30_60d     = deduped.filter((o) => {
      const age = nowMs - o.soldDateMs;
      return age > ms30d && age <= ms60d;
    });
    const obs330_360d   = deduped.filter((o) => {
      const age = nowMs - o.soldDateMs;
      return age > ms330d && age <= ms360d;
    });

    const prices = (arr) => arr.map((o) => o.soldPriceUsd);

    // ── current_price_c3: most-recent sold price in trailing 90d ──────────
    let current_price_c3 = null;
    if (obs90d.length) {
      const newest = obs90d.reduce((a, b) => (a.soldDateMs > b.soldDateMs ? a : b));
      current_price_c3 = newest.soldPriceUsd;
    }

    // ── 12mo aggregates ───────────────────────────────────────────────────
    const p12 = prices(obs12mo);
    const auction_median_12mo  = median(p12);
    const auction_high_12mo    = p12.length ? Math.max(...p12) : null;
    const auction_low_12mo     = p12.length ? Math.min(...p12) : null;
    const auction_count_12mo   = p12.length;

    // Reserve met rate in 12mo (only among obs with a known reserveMet)
    const known12 = obs12mo.filter((o) => o.reserveMet !== null);
    const reserve_met_rate_12mo = known12.length
      ? known12.filter((o) => o.reserveMet === true).length / known12.length
      : null;

    // ── 36mo aggregates ───────────────────────────────────────────────────
    const p36 = prices(obs36mo);
    const auction_median_36mo  = median(p36);
    const auction_count_36mo   = p36.length;

    // ── Mileage median ────────────────────────────────────────────────────
    const mileageNums = obs36mo
      .map((o) => {
        if (!o.mileage) return null;
        const m = o.mileage.replace(/[^0-9]/g, "");
        return m ? parseInt(m, 10) : null;
      })
      .filter((n) => n !== null);
    const mileage_median_sold = median(mileageNums);

    // ── Price momentum ────────────────────────────────────────────────────
    const med30d      = median(prices(obs30d));
    const med30_60d   = median(prices(obs30_60d));
    const med330_360d = median(prices(obs330_360d));

    const price_momentum_1mo = med30d !== null && med30_60d !== null && med30_60d !== 0
      ? (med30d - med30_60d) / med30_60d
      : null;

    const price_momentum_12mo = med30d !== null && med330_360d !== null && med330_360d !== 0
      ? (med30d - med330_360d) / med330_360d
      : null;

    // ── data_status ───────────────────────────────────────────────────────
    const data_status = auction_count_36mo < 5 ? "insufficient" : "ok";

    result[slug] = {
      current_price_c3,
      auction_median_12mo,
      auction_high_12mo,
      auction_low_12mo,
      auction_count_12mo,
      auction_median_36mo,
      auction_count_36mo,
      reserve_met_rate_12mo,
      mileage_median_sold,
      price_momentum_1mo,
      price_momentum_12mo,
      data_status,
      data_sources,
      computed_at,
    };
  }

  return result;
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outputArg = process.argv.find((a) => a.startsWith("--output="));
  if (!outputArg) {
    console.error("Usage: node scripts/build-price-aggregates.mjs --output=<path>");
    process.exit(1);
  }
  const outputPath = outputArg.split("=").slice(1).join("=");

  const CATALOG_PATH  = join(REPO_ROOT, "src/lib/data/cars-ml/cars-catalog.json");
  const OCD_PATH      = join(REPO_ROOT, "src/lib/data/cars-ml/oldcarsdata-current-prices.json");
  const BAT_PATH      = join(REPO_ROOT, "src/lib/data/cars-ml/bat-auction-history.json");

  const catalog     = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  const slugs       = catalog.vehicles.map((v) => v.slug);

  const ocdFile     = JSON.parse(readFileSync(OCD_PATH, "utf8"));
  const oldcarsdataRows = ocdFile.prices ?? {};

  const batHistoryRows = existsSync(BAT_PATH)
    ? JSON.parse(readFileSync(BAT_PATH, "utf8"))
    : {};

  const aggregates = buildAggregates({ oldcarsdataRows, batHistoryRows, slugs });

  const output = {
    generatedAt: new Date().toISOString(),
    aggregates,
  };

  await writeJsonAtomic(outputPath, output);

  jsonLog({
    operation: "price-aggregates.build",
    slugCount: slugs.length,
    okCount: Object.values(aggregates).filter((a) => a.data_status === "ok").length,
    insufficientCount: Object.values(aggregates).filter((a) => a.data_status === "insufficient").length,
    outputPath,
  });
}
