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

const RATE_RPS = Number(process.env.OLDCARSDATA_RPS ?? "2");
const limiter = new RateLimiter(RATE_RPS);
const SLOW_RETRY = { delaysMs: [2000, 6000, 15000] };
const FLUSH_EVERY = Number(process.env.OLDCARSDATA_FLUSH_EVERY ?? "100");
const PROGRESS_EVERY = Number(process.env.OLDCARSDATA_PROGRESS_EVERY ?? "50");

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
  if (!r.ok) {
    if (r.status === 429) {
      const nowSec = Math.floor(Date.now() / 1000);
      const resetSec = Number(reset);
      const waitSec = Number.isFinite(resetSec) && resetSec > nowSec ? resetSec - nowSec : 60;
      // Abort hard if the reset is more than 5 minutes away — that means we've
      // hit a daily/monthly quota wall, not a transient rate limit. Looping is pointless.
      if (waitSec > 300) {
        const err = new Error(`oldcarsdata_quota_exhausted: ${waitSec}s until reset`);
        err.code = "QUOTA_EXHAUSTED";
        err.resetSec = resetSec;
        throw err;
      }
      jsonLog({ operation: "oldcarsdata.rate_limit_wait", waitSec, remaining, reset });
      await sleep(waitSec * 1000);
    }
    return { ok: false, status: r.status, remaining, reset };
  }
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
  // Preserve raw per-sale observations so aggregator can window them properly.
  const salesRaw = sales
    .map((s) => {
      const priceUsd = Number(s.price ?? s.soldPrice);
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
      const dateStr = s.auction_end_date ?? s.auction_end_at ?? s.soldDate ?? s.created_at;
      const soldDateMs = dateStr ? new Date(dateStr).getTime() : null;
      if (!soldDateMs || Number.isNaN(soldDateMs)) return null;
      const mileageNum = Number(s.mileage);
      return {
        priceUsd: Math.round(priceUsd),
        soldDateMs,
        reserveMet: s.has_reserve ? (s.auction_status ?? s.status) === "sold" : null,
        mileage: Number.isFinite(mileageNum) ? mileageNum : null,
      };
    })
    .filter(Boolean);
  return {
    asOf: new Date().toISOString(),
    conditionAnchor: 3,
    valueUsd: Math.round(med),
    auctionMedian12moUsd: Math.round(med),
    auctionCount12mo: prices.length,
    reserveMetRate12mo: reserveMet,
    sales: salesRaw,
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
export async function syncCars({ cars, apiKey, existingPrices = {}, ddbClient, fetchSlug, onFlush, resume = false } = {}) {
  const prices = { ...existingPrices };
  let ok = 0;
  let failed = 0;
  let processed = 0;
  let sinceFlush = 0;

  const queue = resume ? cars.filter((c) => !(c.slug in existingPrices)) : cars;
  if (resume) {
    jsonLog({ operation: "oldcarsdata.resume", skipped: cars.length - queue.length, remaining: queue.length });
  }

  for (const c of queue) {
    try {
      const result = await withCache({
        pk: `oldcarsdata#${c.slug}`,
        sk: "v2",
        ttlSeconds: 30 * 24 * 3600, // 30d (paid tier, historical auctions stable)
        source: "oldcarsdata",
        bundledFallback: async () => existingPrices[c.slug] ?? null,
        fetchOrigin: async () => {
          const raw = fetchSlug
            ? await fetchSlug(c.year, c.make, c.model)
            : await fetchSnapshot(apiKey, c.year, c.make, c.model);
          if (!raw.ok) {
            jsonLog({ operation: "oldcarsdata.miss", slug: c.slug, status: raw.status, remaining: raw.remaining });
            return null;
          }
          return snapshotToPriceRow(raw.body);
        },
        ddbClient,
      });

      if (result.value != null) {
        prices[c.slug] = result.value;
        ok++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      jsonLog({ operation: "oldcarsdata.error", slug: c.slug, error: String(err?.message ?? err) });
      if (err?.code === "QUOTA_EXHAUSTED") {
        jsonLog({ operation: "oldcarsdata.aborted", reason: "quota_exhausted", processed, ok, failed });
        if (onFlush) await onFlush(prices);
        return { prices, ok, failed, recordsProcessed: processed, abortedBy: "quota_exhausted" };
      }
    }

    processed++;
    sinceFlush++;

    if (PROGRESS_EVERY > 0 && processed % PROGRESS_EVERY === 0) {
      jsonLog({
        operation: "oldcarsdata.progress",
        processed,
        total: queue.length,
        ok,
        failed,
        pct: Math.round((processed / queue.length) * 100),
      });
    }

    if (onFlush && FLUSH_EVERY > 0 && sinceFlush >= FLUSH_EVERY) {
      await onFlush(prices);
      sinceFlush = 0;
    }
  }

  if (onFlush && sinceFlush > 0) await onFlush(prices);

  return { prices, ok, failed, recordsProcessed: processed };
}

async function main() {
  const apiKey = process.env.OLDCARSDATA_API_KEY;
  if (!apiKey) {
    jsonLog({ operation: "oldcarsdata.skip", reason: "OLDCARSDATA_API_KEY missing" });
    return;
  }

  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;
  const resume = args.includes("--resume");

  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  let cars = Array.isArray(catalogFile) ? catalogFile : catalogFile.vehicles ?? [];
  if (limit > 0) cars = cars.slice(0, limit);

  let existingPrices = {};
  try {
    const existing = JSON.parse(await readFile(OUT, "utf8"));
    if (existing?.prices) existingPrices = existing.prices;
  } catch { /* fresh run */ }

  jsonLog({ operation: "oldcarsdata.start", totalCars: cars.length, rps: RATE_RPS, resume, alreadyCached: Object.keys(existingPrices).length });

  const flush = async (prices) => {
    await writeJsonAtomic(OUT, { generatedAt: new Date().toISOString(), prices });
    jsonLog({ operation: "oldcarsdata.flush", count: Object.keys(prices).length });
  };

  let syncResult;
  await timed("sync:oldcarsdata", async () => {
    syncResult = await syncCars({ cars, apiKey, existingPrices, onFlush: flush, resume });
    return { recordsProcessed: syncResult.recordsProcessed, ok: syncResult.ok, failed: syncResult.failed };
  });

  await writeJsonAtomic(OUT, { generatedAt: new Date().toISOString(), prices: syncResult.prices });
  jsonLog({ operation: "oldcarsdata.persisted", count: Object.keys(syncResult.prices).length, ok: syncResult.ok, failed: syncResult.failed });
}

// Only execute when run directly — not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    jsonLog({ operation: "oldcarsdata.fatal", error: err });
    process.exit(1);
  });
}
