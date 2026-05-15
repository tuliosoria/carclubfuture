#!/usr/bin/env node
/**
 * sync-oldcarsdata-prices.mjs
 *
 * Pulls live OldCarsData auction snapshots for every catalog vehicle and
 * writes them in PriceRow shape (see src/lib/db/car-search.ts) to
 * src/lib/data/cars-ml/oldcarsdata-current-prices.json.
 *
 * Each slug is routed through the tiered cache helper (L0→L1→L2→L3):
 *   L0  In-process memory  — never burns API quota
 *   L1  DynamoDB (48h TTL) — survives restarts, never burns API quota
 *   L2  Bundled JSON file  — served when DynamoDB is unreachable
 *   L3  OldCarsData API    — only called on a full miss; writes back to L0+L1
 *
 * Free tier = 10 req/month. Once quota is gone, the loop exits early to
 * avoid burning successive 429s. Cache hits (L0/L1/L2) never touch the API.
 *
 * Hardening: 3-retry exponential backoff, 2 req/s rate limit, atomic
 * write of the output JSON, structured stdout logs.
 *
 * Requires OLDCARSDATA_API_KEY. No-ops with exit 0 if missing.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { fetchWithRetry, RateLimiter, writeJsonAtomic, jsonLog, timed } from "./_lib/http.mjs";
import { withCache } from "./_lib/cache.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const OUT = resolve(ROOT, "src/lib/data/cars-ml/oldcarsdata-current-prices.json");
const ENDPOINT = process.env.OLDCARSDATA_BASE_URL ?? "https://api.oldcarsdata.com";
const UA = "CarClubFuture/1.0 (+https://carclubfuture.com)";

const limiter = new RateLimiter(0.5);
const SLOW_RETRY = { delaysMs: [2000, 6000, 15000] };

async function fetchSnapshot(apiKey, year, make, model) {
  await limiter.take();
  const params = new URLSearchParams({
    make,
    model,
    year_min: String(year),
    year_max: String(year),
    status: "sold",
    limit: "100",
  });
  const url = `${ENDPOINT}/auctions?${params.toString()}`;
  const r = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": UA },
  }, SLOW_RETRY);
  const remaining = Number(r.headers.get("x-ratelimit-remaining"));
  const reset = r.headers.get("x-ratelimit-reset");
  if (!r.ok) return { ok: false, status: r.status, remaining, reset };
  return { ok: true, body: await r.json(), remaining, reset };
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function snapshotToPriceRow(snap) {
  const sales = Array.isArray(snap?.data) ? snap.data : Array.isArray(snap?.sales) ? snap.sales : [];
  const prices = sales
    .map((s) => Number(s.price ?? s.soldPrice))
    .filter((n) => Number.isFinite(n) && n > 0);
  const med = median(prices);
  if (med == null) return null;
  const reservedSales = sales.filter((s) => s.has_reserve === true || s.reserve === true);
  const reserveMet = reservedSales.length
    ? reservedSales.filter((s) => (s.auction_status ?? s.status) === "sold").length /
      reservedSales.length
    : null;
  return {
    asOf: new Date().toISOString(),
    conditionAnchor: 3,
    valueUsd: Math.round(med),
    auctionMedian12moUsd: Math.round(med),
    auctionCount12mo: prices.length,
    reserveMetRate12mo: reserveMet,
  };
}

/**
 * Inner sync loop — exported for testability.
 *
 * @param {object}   opts
 * @param {Array}    opts.cars             Catalog vehicles array
 * @param {string}   opts.apiKey           OldCarsData API key
 * @param {object}   [opts.existingPrices] Loaded from the output JSON (L2 source)
 * @param {object}   [opts.ddbClient]      Injected DynamoDB client (tests only)
 * @param {Function} [opts.fetchSlug]      Override raw API call: (year, make, model) =>
 *                                         Promise<{ok, body?, status?, remaining, reset}>
 * @returns {Promise<{prices, ok, failed, recordsProcessed}>}
 */
export async function syncCars({ cars, apiKey, existingPrices = {}, ddbClient, fetchSlug } = {}) {
  // Start from existing prices so unprocessed slugs retain their previous values.
  const prices = { ...existingPrices };
  let ok = 0;
  let failed = 0;

  for (const c of cars) {
    // Track whether this iteration hit the monthly quota cap inside fetchOrigin so
    // we can break after the withCache call (which may still serve L2 for this slug).
    let quotaHit = false;
    let quotaReset = null;

    try {
      const result = await withCache({
        pk: `oldcarsdata#${c.slug}`,
        sk: "v1",
        ttlSeconds: 48 * 3600, // 48h freshness for auction snapshots (per plan)
        source: "oldcarsdata",
        // L2: serve the previously-synced value when DynamoDB is unreachable.
        bundledFallback: async () => existingPrices[c.slug] ?? null,
        // L3: only called on a full cache miss — burns one of the 10 monthly requests.
        fetchOrigin: async () => {
          const raw = fetchSlug
            ? await fetchSlug(c.year, c.make, c.model)
            : await fetchSnapshot(apiKey, c.year, c.make, c.model);

          if (!raw.ok) {
            // Free tier = 10 req/month. Signal quota exhaustion so the loop exits.
            if (raw.status === 429 && raw.remaining === 0) {
              quotaHit = true;
              quotaReset = raw.reset;
              const err = new Error("quota_exhausted");
              err.reset = raw.reset;
              throw err;
            }
            jsonLog({ operation: "oldcarsdata.miss", slug: c.slug, status: raw.status, remaining: raw.remaining });
            return null;
          }
          return snapshotToPriceRow(raw.body);
        },
        ddbClient,
      });

      jsonLog({
        operation: "sync.oldcarsdata",
        slug: c.slug,
        cache_layer: result.layer,
        durationMs: result.durationMs,
      });

      if (result.value != null) {
        prices[c.slug] = result.value;
        ok++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      jsonLog({ operation: "oldcarsdata.error", slug: c.slug, error: err });
    }

    if (quotaHit) {
      jsonLog({ operation: "oldcarsdata.quota_exhausted", reset: quotaReset });
      break;
    }
  }

  return { prices, ok, failed, recordsProcessed: cars.length };
}

async function main() {
  const apiKey = process.env.OLDCARSDATA_API_KEY;
  if (!apiKey) {
    jsonLog({ operation: "oldcarsdata.skip", reason: "OLDCARSDATA_API_KEY missing" });
    return;
  }

  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  const cars = Array.isArray(catalogFile) ? catalogFile : catalogFile.vehicles ?? [];

  let existingPrices = {};
  try {
    const existing = JSON.parse(await readFile(OUT, "utf8"));
    if (existing?.prices) existingPrices = existing.prices;
  } catch { /* fresh run */ }

  let syncResult;
  await timed("sync:oldcarsdata", async () => {
    syncResult = await syncCars({ cars, apiKey, existingPrices });
    return { recordsProcessed: syncResult.recordsProcessed, ok: syncResult.ok, failed: syncResult.failed };
  });

  await writeJsonAtomic(OUT, { generatedAt: new Date().toISOString(), prices: syncResult.prices });
  jsonLog({ operation: "oldcarsdata.persisted", count: Object.keys(syncResult.prices).length });
}

// Only execute when run directly — not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    jsonLog({ operation: "oldcarsdata.fatal", error: err });
    process.exit(1);
  });
}
