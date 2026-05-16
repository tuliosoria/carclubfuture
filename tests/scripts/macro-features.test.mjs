/**
 * Unit tests for scripts/sync-macro-features.mjs and scripts/_lib/csv.mjs
 *
 * All tests are pure-function — no network, no fs.
 *
 * Test cases:
 *   1. compute12moReturn — 400-day series → correct return_12mo
 *   2. compute12moReturn — 100-day series → null (insufficient history)
 *   3. parseCsv — Stooq header format → correct field types
 *   4. parseCsv — trailing blank line ignored
 *   5. buildMacroFeatures — both series present → data_status "ok"
 *   6. buildMacroFeatures — both series null → data_status "insufficient"
 *   7. fetchStooqCsv response with "No data" header → null
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { compute12moReturn, buildMacroFeatures } from "../../scripts/sync-macro-features.mjs";
import { parseCsv } from "../../scripts/_lib/csv.mjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a fake daily price series with `days` entries.
 * Prices start at `startPrice` and increment by `delta` per day.
 */
function buildSeries(days, startPrice = 4000, delta = 1, startDateStr = "2023-01-01") {
  const series = [];
  let current = new Date(startDateStr + "T00:00:00Z");
  let price = startPrice;
  for (let i = 0; i < days; i++) {
    series.push({
      date: current.toISOString().slice(0, 10),
      close: price,
    });
    current = new Date(current.getTime() + 24 * 3600 * 1000);
    price += delta;
  }
  return series;
}

// ── Test 1: 400-day series → correct return ───────────────────────────────────

test("compute12moReturn: 400-day series → hand-computed return matches", () => {
  // 400 days: starts 2023-01-01, each day +1
  // Latest date = 2024-02-05 (day 400), close = 4000 + 399 = 4399
  // 365 days before latest = 2023-02-06; first data point on/after that date:
  //   day 37 = 2023-02-07, close = 4000 + 36 = 4036
  //   day 36 = 2023-02-06, close = 4000 + 35 = 4035
  // We find the first row with date >= targetDateStr.
  // Build the series and let compute12moReturn do the work, then verify manually.
  const series = buildSeries(400, 4000, 1, "2023-01-01");

  const latest = series[series.length - 1];
  const latestDate = new Date(latest.date + "T00:00:00Z");
  const targetDate = new Date(latestDate.getTime() - 365 * 24 * 3600 * 1000);
  const targetStr = targetDate.toISOString().slice(0, 10);

  // Find expected candidate
  const candidate = series.find((r) => r.date >= targetStr && r.date !== latest.date);
  assert.ok(candidate, "candidate should exist");

  const expected = (latest.close - candidate.close) / candidate.close;
  const actual = compute12moReturn(series);

  assert.ok(actual !== null, "return should not be null");
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
});

// ── Test 2: 100-day series → null (insufficient history) ─────────────────────

test("compute12moReturn: 100-day series → null (insufficient history)", () => {
  const series = buildSeries(100, 4000, 1);
  const result = compute12moReturn(series);
  assert.equal(result, null, "100 days is not enough for a 365-day return");
});

// ── Test 3: parseCsv — Stooq header format ────────────────────────────────────

test("parseCsv: Stooq documented header → correct field extraction and types", () => {
  const csv = [
    "Date,Open,High,Low,Close,Volume",
    "2024-01-02,4742.83,4802.64,4731.60,4796.56,1234567890",
    "2024-01-03,4770.10,4800.00,4745.00,4780.24,987654321",
  ].join("\n");

  const rows = parseCsv(csv);
  assert.equal(rows.length, 2, "should parse 2 data rows");

  const row = rows[0];
  assert.equal(row["Date"], "2024-01-02");
  assert.equal(row["Open"], "4742.83");
  assert.equal(row["Close"], "4796.56");

  // Numeric conversion (caller is responsible, but verify parseFloat works)
  assert.ok(Math.abs(parseFloat(row["Close"]) - 4796.56) < 0.001);
});

// ── Test 4: parseCsv — trailing blank line ignored ────────────────────────────

test("parseCsv: trailing blank line does not add spurious rows", () => {
  const csv = "Date,Open,High,Low,Close,Volume\n2024-01-02,4742.83,4802.64,4731.60,4796.56,0\n\n";
  const rows = parseCsv(csv);
  // trim() in parseCsv removes the trailing blank line
  assert.equal(rows.length, 1, "trailing blank should not produce an extra row");
});

// ── Test 5: buildMacroFeatures — both series → "ok" ──────────────────────────

test("buildMacroFeatures: both series present with enough history → data_status 'ok'", () => {
  const now = new Date("2024-06-01T00:00:00Z");
  const sp500Series = buildSeries(400, 4000, 2, "2023-03-01");
  const goldSeries  = buildSeries(400, 1800, 1, "2023-03-01");

  const features = buildMacroFeatures({ sp500Series, goldSeries, now });

  assert.equal(features.data_status, "ok");
  assert.ok(features.correlated_sp500_12mo !== null, "sp500 return should be non-null");
  assert.ok(features.correlated_gold_12mo  !== null, "gold return should be non-null");
  assert.equal(features.collector_market_index_12mo, null, "collector index still null");
  assert.ok(typeof features.computed_at === "string");
});

// ── Test 6: buildMacroFeatures — both series null → "insufficient" ────────────

test("buildMacroFeatures: both series null → data_status 'insufficient'", () => {
  const features = buildMacroFeatures({ sp500Series: null, goldSeries: null });

  assert.equal(features.data_status, "insufficient");
  assert.equal(features.correlated_sp500_12mo, null);
  assert.equal(features.correlated_gold_12mo, null);
  assert.equal(features.collector_market_index_12mo, null);
});

// ── Test 7: empty series returns null ────────────────────────────────────────

test("compute12moReturn: empty or single-entry series → null", () => {
  assert.equal(compute12moReturn([]), null);
  assert.equal(compute12moReturn([{ date: "2024-01-01", close: 100 }]), null);
  assert.equal(compute12moReturn(null), null);
});
