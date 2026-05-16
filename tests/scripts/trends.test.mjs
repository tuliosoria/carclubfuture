/**
 * Unit tests for scripts/_lib/trends.mjs
 *
 * Uses an injected trendsClient — no real HTTP calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchTrendScore } from "../../scripts/_lib/trends.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTimelineData(values) {
  return values.map((v, i) => ({
    formattedAxisTime: `Day ${i}`,
    value: [v],
  }));
}

function makeFakeTrendsClient(timelineData) {
  return {
    interestOverTime: async () =>
      JSON.stringify({ default: { timelineData } }),
  };
}

// ---------------------------------------------------------------------------
// Test 1: score30d is the mean of the last 30 entries
// ---------------------------------------------------------------------------
test("score30d is mean of the last 30 entries", async () => {
  // First 60 data points: value 20; last 30: value 80
  const data = makeTimelineData([
    ...Array(60).fill(20),
    ...Array(30).fill(80),
  ]);

  const result = await fetchTrendScore("1969 Chevrolet Camaro", {
    trendsClient: makeFakeTrendsClient(data),
  });

  assert.equal(result.score30d, 80, "score30d should be mean of last 30 values = 80");
  assert.ok(result.momentum90d > 0, "momentum should be positive (values increase over time)");
  assert.equal(result.raw.length, 90);
  assert.ok(!result.error, "should have no error");
});

// ---------------------------------------------------------------------------
// Test 2: flat trend → score30d is the value, momentum90d ≈ 0
// ---------------------------------------------------------------------------
test("flat trend → momentum90d near zero", async () => {
  const data = makeTimelineData(Array(90).fill(50));
  const result = await fetchTrendScore("test", {
    trendsClient: makeFakeTrendsClient(data),
  });

  assert.equal(result.score30d, 50);
  assert.ok(Math.abs(result.momentum90d) < 1e-10, "momentum should be ~0 for flat trend");
});

// ---------------------------------------------------------------------------
// Test 3: error shape when trendsClient throws
// ---------------------------------------------------------------------------
test("returns null scores on trendsClient failure", async () => {
  const badClient = {
    interestOverTime: async () => { throw new Error("Google Trends API down"); },
  };

  const result = await fetchTrendScore("test query", { trendsClient: badClient });

  assert.equal(result.score30d, null);
  assert.equal(result.momentum90d, null);
  assert.deepEqual(result.raw, []);
  assert.ok(result.error, "should include error message");
});

// ---------------------------------------------------------------------------
// Test 4: empty data → null scores with error message
// ---------------------------------------------------------------------------
test("empty timeline data → null scores", async () => {
  const result = await fetchTrendScore("test", {
    trendsClient: makeFakeTrendsClient([]),
  });

  assert.equal(result.score30d, null);
  assert.equal(result.momentum90d, null);
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// Test 5: handles client returning pre-parsed object (not string)
// ---------------------------------------------------------------------------
test("handles client returning parsed object (not JSON string)", async () => {
  const data = makeTimelineData(Array(30).fill(60));
  const client = {
    interestOverTime: async () => ({ default: { timelineData: data } }),
  };

  const result = await fetchTrendScore("test", { trendsClient: client });

  assert.equal(result.score30d, 60);
});
