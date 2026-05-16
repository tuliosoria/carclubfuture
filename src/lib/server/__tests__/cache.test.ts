/**
 * Behavioural tests for src/lib/server/cache.ts
 *
 * Tests call the REAL exported functions via test seams (__setTestClient,
 * __setBundledOverrides) so that breaking cache.ts causes test failures.
 *
 * Run:
 *   node --conditions react-server --experimental-strip-types \
 *        --test src/lib/server/__tests__/cache.test.ts
 *
 * Test fidelity verified: flipping `expiresAt * 1000 > Date.now()` to `<`
 * in cache.ts causes test 2 to fail (L1 hit returns MISS instead of L1).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PriceSnapshot } from "@/lib/types/cars";
import {
  getCachedAuction,
  getCachedImage,
  clearMemoryCache,
  __setTestClient,
  __setBundledOverrides,
} from "../cache.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TestClientArg = Parameters<typeof __setTestClient>[0];

/** Build a mock DDB document client that returns the given Item. */
function mockDdb(item: Record<string, unknown> | undefined): TestClientArg {
  return {
    send: async () => ({ Item: item }),
  } as unknown as TestClientArg;
}

const baseSnapshot: PriceSnapshot = {
  asOf: "2026-01-01T00:00:00.000Z",
  conditionAnchor: 3,
  valueUsd: 72250,
  auctionMedian12moUsd: 72250,
  auctionCount12mo: 20,
  reserveMetRate12mo: 1,
  source: "oldcarsdata",
};

// ---------------------------------------------------------------------------
// Test 1: full miss — empty L1 + empty L2 → MISS
// ---------------------------------------------------------------------------

test("getCachedAuction: full miss when DynamoDB empty and bundled JSON empty", async () => {
  clearMemoryCache();
  __setTestClient(mockDdb(undefined));
  __setBundledOverrides({ prices: {}, images: {} });

  const result = await getCachedAuction("nonexistent");

  assert.equal(result.value, null);
  assert.equal(result.layer, "MISS");
  assert.equal(result.source, "miss");
});

// ---------------------------------------------------------------------------
// Test 2: L1 hit warms L0; second call returns from L0 (different layer)
// ---------------------------------------------------------------------------

test("getCachedAuction: L1 hit warms L0; second call returns L0", async () => {
  clearMemoryCache();
  const futureEpochSec = Math.floor((Date.now() + 3_600_000) / 1000);
  __setTestClient(
    mockDdb({
      pk: "oldcarsdata#slug-x",
      sk: "v1",
      payload: baseSnapshot,
      cachedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: futureEpochSec,
      source: "oldcarsdata",
    }),
  );
  __setBundledOverrides({ prices: {}, images: {} });

  const first = await getCachedAuction("slug-x");
  assert.equal(first.layer, "L1", "first call should hit L1");
  assert.deepEqual(first.value, baseSnapshot);

  // L0 should now be warm — switch DDB to return nothing to prove L0 answers
  __setTestClient(mockDdb(undefined));
  const second = await getCachedAuction("slug-x");
  assert.equal(second.layer, "L0", "second call should return from L0");
  assert.deepEqual(second.value, baseSnapshot);
});

// ---------------------------------------------------------------------------
// Test 3: L1 miss + L2 hit → layer="L2", source="bundled"
// ---------------------------------------------------------------------------

test("getCachedAuction: L1 miss falls through to L2 bundled JSON", async () => {
  clearMemoryCache();
  __setTestClient(mockDdb(undefined));
  const bundledSnapshot: PriceSnapshot = { ...baseSnapshot, source: "bundled" };
  __setBundledOverrides({ prices: { "slug-y": bundledSnapshot }, images: {} });

  const result = await getCachedAuction("slug-y");

  assert.equal(result.layer, "L2");
  assert.equal(result.source, "bundled");
  assert.deepEqual(result.value, bundledSnapshot);
});
