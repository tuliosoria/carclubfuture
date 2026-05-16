/**
 * Unit tests for scripts/build-limitations-report.mjs
 *
 * Tests the pure `buildLimitationsReport` function directly — no fs or network.
 *
 * Test cases:
 *   1. Empty catalog — all counts 0, no slugs in lists
 *   2. Mixed eligibility — 5 cars where 2 have auction_count_36mo >= 5
 *   3. Image missing pass-through — slugs propagated from missingImages
 *   4. Macro status mapping — null values → "insufficient"
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildLimitationsReport } from "../../scripts/build-limitations-report.mjs";

// ── Test 1: Empty catalog ─────────────────────────────────────────────────────

test("empty catalog — all counts 0, no slugs in lists", () => {
  const report = buildLimitationsReport({
    catalog: { vehicles: [] },
    priceAggregates: {},
    communityScores: {},
    missingImages: { slugs: [] },
    macroFeatures: {},
    trainingSummary: {},
    apiCallStats: [],
  });

  assert.equal(report.vehicles.total_catalog, 0);
  assert.equal(report.vehicles.forecast_eligible, 0);
  assert.deepEqual(report.vehicles.not_forecast_eligible, []);
  assert.deepEqual(report.vehicles.image_missing, []);
  assert.deepEqual(report.vehicles.community_low_confidence, []);
  assert.equal(report.data_sources.macro.sp500_status, "insufficient");
  assert.equal(report.data_sources.macro.gold_status, "insufficient");
  assert.equal(report.ml.status, "unknown");
  assert.deepEqual(report.ml.trained_horizons, []);
  assert.deepEqual(report.api_errors, []);
  assert.ok(Array.isArray(report.open_questions));
  assert.ok(report.open_questions.length > 0);
  assert.ok(typeof report.generated_at === "string");
});

// ── Test 2: Mixed eligibility ─────────────────────────────────────────────────

test("mixed eligibility — 2 of 5 have auction_count_36mo >= 5", () => {
  const slugs = ["car-a", "car-b", "car-c", "car-d", "car-e"];
  const catalog = { vehicles: slugs.map((slug) => ({ slug })) };

  const priceAggregates = {
    "car-a": { auction_count_36mo: 10 }, // eligible
    "car-b": { auction_count_36mo: 5 },  // eligible (boundary)
    "car-c": { auction_count_36mo: 4 },  // not eligible
    "car-d": { auction_count_36mo: 0 },  // not eligible
    // car-e: missing entirely — not eligible
  };

  const report = buildLimitationsReport({
    catalog,
    priceAggregates,
    communityScores: {},
    missingImages: { slugs: [] },
    macroFeatures: {},
    trainingSummary: {},
    apiCallStats: [],
  });

  assert.equal(report.vehicles.total_catalog, 5);
  assert.equal(report.vehicles.forecast_eligible, 2);
  assert.deepEqual(
    [...report.vehicles.not_forecast_eligible].sort(),
    ["car-c", "car-d", "car-e"].sort()
  );
});

// ── Test 3: Image missing pass-through ────────────────────────────────────────

test("image missing pass-through — slugs from missingImages propagated", () => {
  const report = buildLimitationsReport({
    catalog: { vehicles: [{ slug: "car-a" }, { slug: "car-b" }] },
    priceAggregates: {},
    communityScores: {},
    missingImages: { slugs: ["car-a", "car-b"] },
    macroFeatures: {},
    trainingSummary: {},
    apiCallStats: [],
  });

  assert.deepEqual(report.vehicles.image_missing, ["car-a", "car-b"]);
});

// ── Test 4: Macro status mapping ──────────────────────────────────────────────

test("macro status mapping — null correlated values → 'insufficient'", () => {
  const report = buildLimitationsReport({
    catalog: { vehicles: [] },
    priceAggregates: {},
    communityScores: {},
    missingImages: {},
    macroFeatures: {
      correlated_sp500_12mo: null,
      correlated_gold_12mo: null,
      data_status: "insufficient",
    },
    trainingSummary: {},
    apiCallStats: [],
  });

  assert.equal(report.data_sources.macro.sp500_status, "insufficient");
  assert.equal(report.data_sources.macro.gold_status, "insufficient");
});

test("macro status mapping — non-null correlated values → 'ok'", () => {
  const report = buildLimitationsReport({
    catalog: { vehicles: [] },
    priceAggregates: {},
    communityScores: {},
    missingImages: {},
    macroFeatures: {
      correlated_sp500_12mo: 0.72,
      correlated_gold_12mo: 0.45,
    },
    trainingSummary: {},
    apiCallStats: [],
  });

  assert.equal(report.data_sources.macro.sp500_status, "ok");
  assert.equal(report.data_sources.macro.gold_status, "ok");
});

// ── Test 5: Community low confidence ─────────────────────────────────────────

test("community low confidence — slugs with < 10 data_points listed", () => {
  const catalog = {
    vehicles: [
      { slug: "car-high" },
      { slug: "car-low" },
      { slug: "car-missing" },
    ],
  };
  const communityScores = {
    "car-high": { data_points: 15 },
    "car-low": { data_points: 3 },
    // car-missing: absent
  };

  const report = buildLimitationsReport({
    catalog,
    priceAggregates: {},
    communityScores,
    missingImages: {},
    macroFeatures: {},
    trainingSummary: {},
    apiCallStats: [],
  });

  assert.deepEqual(
    [...report.vehicles.community_low_confidence].sort(),
    ["car-low", "car-missing"].sort()
  );
  assert.ok(!report.vehicles.community_low_confidence.includes("car-high"));
});

// ── Test 6: ML horizons ───────────────────────────────────────────────────────

test("ML horizons — trained and untrained correctly split", () => {
  const report = buildLimitationsReport({
    catalog: { vehicles: [] },
    priceAggregates: {},
    communityScores: {},
    missingImages: {},
    macroFeatures: {},
    trainingSummary: {
      status: "insufficient_data",
      horizons: {
        "1yr": { trained: false, reason: "insufficient_eligible_rows" },
        "3yr": { trained: false, reason: "no_historical_snapshots" },
        "5yr": { trained: false, reason: "no_historical_snapshots" },
      },
    },
    apiCallStats: [],
  });

  assert.equal(report.ml.status, "insufficient_data");
  assert.deepEqual(report.ml.trained_horizons, []);
  assert.equal(report.ml.untrained_horizons.length, 3);
  assert.ok(
    report.ml.untrained_horizons.some(
      (h) => h.horizon === "1yr" && h.reason === "insufficient_eligible_rows"
    )
  );
});

// ── Test 7: API errors pass-through ──────────────────────────────────────────

test("api_errors are passed through unchanged", () => {
  const apiCallStats = [
    {
      source: "oldcarsdata",
      status_code: 429,
      slug: "car-a",
      occurred_at: "2025-01-01T00:00:00Z",
    },
  ];

  const report = buildLimitationsReport({
    catalog: { vehicles: [] },
    priceAggregates: {},
    communityScores: {},
    missingImages: {},
    macroFeatures: {},
    trainingSummary: {},
    apiCallStats,
  });

  assert.deepEqual(report.api_errors, apiCallStats);
});

// ── Test 8: open_questions always present ────────────────────────────────────

test("open_questions section always present with at least 4 items", () => {
  const report = buildLimitationsReport();
  assert.ok(Array.isArray(report.open_questions));
  assert.ok(report.open_questions.length >= 4);
  // Verify the known gaps are surfaced
  assert.ok(
    report.open_questions.some((q) => q.includes("OldCarsData")),
    "should mention OldCarsData tier limitation"
  );
  assert.ok(
    report.open_questions.some((q) => q.includes("Stooq")),
    "should mention Stooq captcha issue"
  );
});
