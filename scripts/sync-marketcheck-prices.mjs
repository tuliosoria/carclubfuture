#!/usr/bin/env node
/**
 * sync-marketcheck-prices.mjs
 *
 * Pulls Marketcheck `/v2/sales/car?ymm=YYYY|make|model` aggregate stats
 * for every catalog vehicle with year >= 1985 (Marketcheck has no
 * pre-1985 dealer inventory) and writes them to
 *   src/lib/data/cars-ml/marketcheck-stats.json
 *
 * Output schema (per slug):
 *   {
 *     source: "marketcheck",
 *     asOf: ISO-8601,
 *     askMedianUsd, askMeanUsd, askIqrUsd,
 *     domMedianDays, domMeanDays,
 *     milesMedianMi,
 *     listingCount, cpoCount
 *   }
 *
 * Important: these are ASKING prices (dealer inventory), not auction-sold
 * prices. Forecast logic must label them clearly and prefer OldCarsData
 * (auction-sold) when both are present.
 *
 * Idempotent: re-running merges new entries into the existing file
 * without dropping previously-synced slugs.
 *
 * Usage:
 *   MARKETCHECK_API_KEY=xxx node scripts/sync-marketcheck-prices.mjs [--limit=N] [--min-year=1985]
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { fetchWithRetry, RateLimiter, writeJsonAtomic, jsonLog } from "./_lib/http.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const OUT = resolve(ROOT, "src/lib/data/cars-ml/marketcheck-stats.json");
const ENDPOINT = process.env.MARKETCHECK_BASE_URL ?? "https://api.marketcheck.com/v2";
const UA = "CarClubFuture/1.0 (+https://carclubfuture.com)";

function parseArgs() {
  const out = { limit: Infinity, minYear: 1985 };
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.+)$/);
    if (!m) continue;
    if (m[1] === "limit") out.limit = Number(m[2]);
    if (m[1] === "min-year") out.minYear = Number(m[2]);
  }
  return out;
}

async function fetchYmmStats(apiKey, year, make, model, limiter) {
  await limiter.take();
  const ymm = `${year}|${make.toLowerCase()}|${model.toLowerCase()}`;
  const url = `${ENDPOINT}/sales/car?api_key=${apiKey}&ymm=${encodeURIComponent(ymm)}`;
  const r = await fetchWithRetry(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (r.status === 422 || r.status === 404) return null; // no inventory for this YMM — normal
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`marketcheck ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

function normalize(raw) {
  // Marketcheck returns {count, cpo, non_cpo, price_stats:{median,mean,iqr},
  // dom_stats:{median,mean}, miles_stats:{median}}
  const price = raw.price_stats ?? {};
  const dom = raw.dom_stats ?? {};
  const miles = raw.miles_stats ?? {};
  return {
    source: "marketcheck",
    asOf: new Date().toISOString(),
    askMedianUsd: price.median ?? null,
    askMeanUsd: price.mean ?? null,
    askIqrUsd: price.iqr ?? null,
    domMedianDays: dom.median ?? null,
    domMeanDays: dom.mean ?? null,
    milesMedianMi: miles.median ?? null,
    listingCount: raw.count ?? 0,
    cpoCount: raw.cpo ?? 0,
  };
}

async function main() {
  const apiKey = process.env.MARKETCHECK_API_KEY;
  if (!apiKey) {
    jsonLog({ operation: "sync-marketcheck", ok: false, error: "missing MARKETCHECK_API_KEY" });
    process.exit(0); // no-op like sync-oldcarsdata
  }
  const args = parseArgs();
  const t0 = Date.now();

  const catalog = JSON.parse(await readFile(CATALOG, "utf8"));
  const vehicles = catalog.vehicles ?? [];

  // Build unique-YMM list (1985+), preserving first-seen slug ordering for stability.
  const seen = new Set();
  const work = [];
  for (const v of vehicles) {
    if (!v.year || v.year < args.minYear) continue;
    const key = `${v.year}|${v.make.toLowerCase()}|${v.model.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    work.push({ slug: v.slug, year: v.year, make: v.make, model: v.model });
    if (work.length >= args.limit) break;
  }

  // Merge into existing file if present (idempotent re-runs).
  let existing = { generatedAt: null, source: "marketcheck", stats: {} };
  if (existsSync(OUT)) {
    try { existing = JSON.parse(await readFile(OUT, "utf8")); } catch { /* fresh start */ }
  }
  const stats = existing.stats ?? {};

  const limiter = new RateLimiter(2); // 2 req/s, conservative
  let ok = 0, failed = 0, skippedNoData = 0;
  for (let i = 0; i < work.length; i++) {
    const { slug, year, make, model } = work[i];
    try {
      const raw = await fetchYmmStats(apiKey, year, make, model, limiter);
      if (raw === null) { skippedNoData++; continue; }
      const norm = normalize(raw);
      if (!norm.listingCount || !norm.askMedianUsd) {
        skippedNoData++;
        continue;
      }
      stats[slug] = norm;
      ok++;
      if (ok % 25 === 0) {
        jsonLog({ operation: "sync-marketcheck", progress: { i: i + 1, total: work.length, ok, failed, skippedNoData } });
        // Periodic checkpoint write so a crash doesn't lose progress.
        await writeJsonAtomic(OUT, { generatedAt: new Date().toISOString(), source: "marketcheck", stats });
      }
    } catch (err) {
      failed++;
      jsonLog({ operation: "sync-marketcheck", slug, ok: false, error: String(err).slice(0, 200) });
      if (failed > 20) {
        jsonLog({ operation: "sync-marketcheck", aborted: true, reason: "too many failures" });
        break;
      }
    }
  }

  await writeJsonAtomic(OUT, { generatedAt: new Date().toISOString(), source: "marketcheck", stats });
  jsonLog({
    operation: "sync-marketcheck",
    ok: true,
    durationMs: Date.now() - t0,
    recordsProcessed: work.length,
    written: ok,
    failed,
    skippedNoData,
    totalCached: Object.keys(stats).length,
  });
}

main().catch((err) => {
  jsonLog({ operation: "sync-marketcheck", ok: false, error: String(err) });
  process.exit(1);
});
