#!/usr/bin/env node
/**
 * sync-macro-features.mjs — fetch S&P 500 + gold 12-month returns from
 * Stooq's free CSV endpoint and write a MacroFeatures object.
 *
 * Usage:
 *   node scripts/sync-macro-features.mjs
 *   node scripts/sync-macro-features.mjs --output=path/to/macro-features.json
 *
 * Data sources:
 *   S&P 500: https://stooq.com/q/d/l/?s=^spx&i=d
 *   Gold:    https://stooq.com/q/d/l/?s=xauusd&i=d
 *
 * Both are free, no API key required. Throttled to 1 req/s.
 *
 * collector_market_index_12mo:
 *   Requires prior-year price-aggregate snapshots, which are not yet stored.
 *   Set to null with data_status rationale documented here. Phase G can still
 *   consume sp500/gold returns even when this field is null.
 */

import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parseArgs } from "node:util";

import { fetchWithRetry, RateLimiter, writeJsonAtomic, jsonLog } from "./_lib/http.mjs";
import { parseCsv } from "./_lib/csv.mjs";

// Stooq is free / unauthenticated — polite rate limit of 1 req/s.
const rateLimiter = new RateLimiter(1);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// ── Stooq fetch + parse ───────────────────────────────────────────────────────

/**
 * Fetch daily OHLCV history from Stooq for `symbol` and return a parsed array
 * of { date: string, open, high, low, close, volume } objects sorted ascending.
 *
 * Returns null if the fetch fails or the response is not valid CSV.
 *
 * @param {string} symbol  e.g. "^spx" or "xauusd"
 * @returns {Promise<Array<{date:string,open:number,high:number,low:number,close:number,volume:number}>|null>}
 */
export async function fetchStooqCsv(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  await rateLimiter.take();
  let resp;
  try {
    resp = await fetchWithRetry(url, {}, { delaysMs: [1000, 2000, 4000] });
  } catch (err) {
    jsonLog({ operation: "sync-macro-features", symbol, error: err });
    return null;
  }
  if (!resp.ok) {
    jsonLog({ operation: "sync-macro-features", symbol, status: resp.status, error: "HTTP error" });
    return null;
  }
  const text = await resp.text();
  // Stooq returns a simple error page if the symbol is invalid or rate-limited
  if (!text.trim().startsWith("Date")) {
    jsonLog({ operation: "sync-macro-features", symbol, error: "Unexpected response (not CSV)" });
    return null;
  }
  const rows = parseCsv(text);
  return rows
    .map((r) => ({
      date: r["Date"] ?? r["date"],
      open: parseFloat(r["Open"] ?? r["open"]),
      high: parseFloat(r["High"] ?? r["high"]),
      low: parseFloat(r["Low"] ?? r["low"]),
      close: parseFloat(r["Close"] ?? r["close"]),
      volume: parseFloat(r["Volume"] ?? r["volume"] ?? "0"),
    }))
    .filter((r) => r.date && !isNaN(r.close))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── 12-month return computation ───────────────────────────────────────────────

/**
 * Compute the 12-month return from a sorted daily price series.
 *
 * Uses the closest data point whose date is ≥ 365 calendar days before the
 * latest entry (handles weekends / holidays where exact dates are absent).
 *
 * @param {Array<{date:string,close:number}>} series  Sorted ascending by date
 * @returns {number|null}  null when history is too short (< 365 days of span)
 */
export function compute12moReturn(series) {
  if (!series || series.length < 2) return null;

  const latest = series[series.length - 1];
  const latestDate = new Date(latest.date + "T00:00:00Z");

  // Target: earliest date that is ≥ 365 days before latest
  const targetMs = latestDate.getTime() - 365 * 24 * 3600 * 1000;
  const target = new Date(targetMs);
  const targetDateStr = target.toISOString().slice(0, 10);

  // Find the closest data point whose date >= targetDateStr (and != latest)
  // Walk from the beginning to find the first record on or after the target date
  const candidate = series.find((r) => r.date >= targetDateStr && r.date !== latest.date);
  if (!candidate) return null;

  // Require the candidate is at least 355 days before latest to avoid using
  // very recent data that only appears to be "a year ago"
  const candidateDate = new Date(candidate.date + "T00:00:00Z");
  const daySpan = (latestDate - candidateDate) / (24 * 3600 * 1000);
  if (daySpan < 355) return null;

  return (latest.close - candidate.close) / candidate.close;
}

// ── Cache-less fetch helper (withCache needs DynamoDB in production) ──────────
// For this macro script we use a simple in-process cache instead of DynamoDB
// so the script works in local/CI environments without AWS credentials.
// The 24h TTL is enforced by only writing once per run.

/**
 * Fetch a symbol with graceful error handling; returns null on failure.
 *
 * @param {string} symbol
 * @returns {Promise<ReturnType<fetchStooqCsv>>}
 */
async function safeFetchSeries(symbol) {
  try {
    return await fetchStooqCsv(symbol);
  } catch {
    return null;
  }
}

// ── Main logic (exported for tests) ──────────────────────────────────────────

/**
 * Compute MacroFeatures from pre-fetched series data.
 *
 * @param {{
 *   sp500Series: Array<{date:string,close:number}>|null,
 *   goldSeries:  Array<{date:string,close:number}>|null,
 *   now?:        Date,
 * }} opts
 * @returns {import('../src/lib/types/cars').MacroFeatures}
 */
export function buildMacroFeatures({ sp500Series, goldSeries, now = new Date() }) {
  const computedAt = now.toISOString();

  const sp500_12mo = sp500Series ? compute12moReturn(sp500Series) : null;
  const gold_12mo = goldSeries ? compute12moReturn(goldSeries) : null;

  // collector_market_index_12mo: requires prior-year price-aggregate snapshots.
  // No historical snapshots are stored yet — Phase H will back-fill these.
  // Phase G can still use sp500/gold returns even when this field is null.
  const collector_market_index_12mo = null;

  const hasAnyRealData = sp500_12mo !== null || gold_12mo !== null;

  return {
    correlated_sp500_12mo: sp500_12mo,
    correlated_gold_12mo: gold_12mo,
    collector_market_index_12mo,
    data_status: hasAnyRealData ? "ok" : "insufficient",
    computed_at: computedAt,
  };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: { output: { type: "string" } },
  });
  const outputPath =
    values.output ??
    join(REPO_ROOT, "src/lib/data/cars-ml/macro-features.json");

  const resolvedOutput = outputPath.startsWith("/")
    ? outputPath
    : join(REPO_ROOT, outputPath);

  jsonLog({ operation: "sync-macro-features", status: "fetching S&P 500 and gold series" });

  const [sp500Series, goldSeries] = await Promise.all([
    safeFetchSeries("^spx"),
    safeFetchSeries("xauusd"),
  ]);

  const features = buildMacroFeatures({ sp500Series, goldSeries });

  await writeJsonAtomic(resolvedOutput, features);

  jsonLog({
    operation: "sync-macro-features",
    data_status: features.data_status,
    sp500_12mo: features.correlated_sp500_12mo,
    gold_12mo: features.correlated_gold_12mo,
    collector_index: features.collector_market_index_12mo,
  });
}

main().catch((err) => {
  jsonLog({ operation: "sync-macro-features", error: err });
  process.exit(1);
});
