/**
 * Unit tests for scripts/_lib/cache.mjs
 *
 * Covers all 6 behavior-contract items.
 * All DynamoDB interactions are mocked via ddbClient injection.
 * No real AWS calls are made.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import {
  withCache,
  getCached,
  putCached,
  clearMemoryCache,
} from "../../scripts/_lib/cache.mjs";

/**
 * Build a fake DynamoDBDocumentClient.
 *
 * @param {object} opts
 * @param {object|null} opts.getItem   - Item to return from GetCommand (null = miss)
 * @param {Error|null}  opts.getError  - If set, GetCommand rejects with this error
 * @param {Array}       opts.puts      - Mutable array that collects PutCommand inputs
 */
function mockDdb({ getItem = null, getError = null, puts = [] } = {}) {
  return {
    send(cmd) {
      if (cmd instanceof GetCommand) {
        if (getError) return Promise.reject(getError);
        return Promise.resolve({ Item: getItem ?? undefined });
      }
      if (cmd instanceof PutCommand) {
        puts.push(cmd.input);
        return Promise.resolve({});
      }
      return Promise.resolve({});
    },
  };
}

// ---------------------------------------------------------------------------
// Contract 1: L0 hit short-circuits (no DDB, no fetchOrigin)
// ---------------------------------------------------------------------------
test("L0 hit short-circuits", async () => {
  clearMemoryCache();

  const puts = [];
  let getCalls = 0;
  const ddb = {
    send(cmd) {
      if (cmd instanceof GetCommand) {
        getCalls++;
        return Promise.resolve({ Item: undefined }); // miss
      }
      if (cmd instanceof PutCommand) {
        puts.push(cmd.input);
        return Promise.resolve({});
      }
    },
  };

  const now = () => 1_000_000; // fixed timestamp (ms)

  // First call → L3 miss, fetches origin, writes to L0 + L1
  const r1 = await withCache({
    pk: "l0-test",
    sk: "v1",
    ttlSeconds: 300,
    fetchOrigin: async () => ({ data: "hello" }),
    source: "test",
    ddbClient: ddb,
    now,
  });
  assert.equal(r1.layer, "L3");
  assert.equal(getCalls, 1);
  assert.equal(puts.length, 1);

  // Reset call counts
  getCalls = 0;

  // Second call with same pk+sk → must be L0, DDB never touched
  const r2 = await withCache({
    pk: "l0-test",
    sk: "v1",
    ttlSeconds: 300,
    fetchOrigin: async () => {
      throw new Error("fetchOrigin must not be called on L0 hit");
    },
    source: "test",
    ddbClient: ddb,
    now,
  });

  assert.equal(r2.layer, "L0");
  assert.equal(getCalls, 0, "DDB must not be queried on L0 hit");
  assert.deepEqual(r2.value, { data: "hello" });
});

// ---------------------------------------------------------------------------
// Contract 2: L1 hit warms L0 (subsequent call must be L0)
// ---------------------------------------------------------------------------
test("L1 hit warms L0", async () => {
  clearMemoryCache();

  const now = () => 1_000_000; // ms
  const expiresAt = Math.floor((now() + 300_000) / 1000); // future, epoch-seconds

  let getCalls = 0;
  const ddb = {
    send(cmd) {
      if (cmd instanceof GetCommand) {
        getCalls++;
        return Promise.resolve({
          Item: {
            pk: "l1-test",
            sk: "v1",
            payload: { val: 42 },
            cachedAt: new Date(now()).toISOString(),
            expiresAt,
            source: "test",
          },
        });
      }
      return Promise.resolve({});
    },
  };

  // First call → L1 (DDB returns valid record)
  const r1 = await withCache({
    pk: "l1-test",
    sk: "v1",
    ttlSeconds: 300,
    fetchOrigin: async () => {
      throw new Error("fetchOrigin must not be called on L1 hit");
    },
    source: "test",
    ddbClient: ddb,
    now,
  });

  assert.equal(r1.layer, "L1");
  assert.equal(getCalls, 1);
  assert.deepEqual(r1.value, { val: 42 });

  // Reset
  getCalls = 0;

  // Second call with same pk+sk → must be L0 (L0 was warmed by the L1 hit)
  const r2 = await withCache({
    pk: "l1-test",
    sk: "v1",
    ttlSeconds: 300,
    fetchOrigin: async () => {
      throw new Error("fetchOrigin must not be called on L0 hit");
    },
    source: "test",
    ddbClient: ddb,
    now,
  });

  assert.equal(r2.layer, "L0");
  assert.equal(getCalls, 0, "DDB must not be queried after L0 was warmed");
  assert.deepEqual(r2.value, { val: 42 });
});

// ---------------------------------------------------------------------------
// Contract 3: Expired L1 entries are ignored — proceeds to L3
// ---------------------------------------------------------------------------
test("Expired L1 entries are ignored", async () => {
  clearMemoryCache();

  // now() is in the future relative to the stored expiresAt
  const now = () => 2_000_000; // ms
  const expiresAt = Math.floor(500_000 / 1000); // 500 — in the past

  let originCalled = false;
  const puts = [];

  const ddb = mockDdb({
    getItem: {
      pk: "expired-test",
      sk: "v1",
      payload: { stale: true },
      cachedAt: new Date(500_000).toISOString(),
      expiresAt,
      source: "test",
    },
    puts,
  });

  const r = await withCache({
    pk: "expired-test",
    sk: "v1",
    ttlSeconds: 300,
    fetchOrigin: async () => {
      originCalled = true;
      return { fresh: true };
    },
    source: "test",
    ddbClient: ddb,
    now,
  });

  assert.equal(r.layer, "L3", "expired L1 record should not be served");
  assert.ok(originCalled, "fetchOrigin should have been called");
  assert.deepEqual(r.value, { fresh: true });
  assert.equal(puts.length, 1, "fresh value should be written back");
});

// ---------------------------------------------------------------------------
// Contract 4: L2 fallback when DynamoDB throws
// ---------------------------------------------------------------------------
test("L2 fallback when DynamoDB throws", async () => {
  clearMemoryCache();

  const now = () => 1_000_000;
  const puts = [];
  let putCalled = false;

  const ddb = {
    send(cmd) {
      if (cmd instanceof GetCommand)
        return Promise.reject(new Error("DynamoDB throttle"));
      if (cmd instanceof PutCommand) {
        putCalled = true;
        puts.push(cmd.input);
        return Promise.resolve({});
      }
    },
  };

  let fallbackCalled = false;

  const r = await withCache({
    pk: "l2-test",
    sk: "v1",
    ttlSeconds: 300,
    fetchOrigin: async () => {
      throw new Error("fetchOrigin must not be called when L2 covers the miss");
    },
    bundledFallback: async () => {
      fallbackCalled = true;
      return { bundled: true };
    },
    source: "test",
    ddbClient: ddb,
    now,
  });

  assert.equal(r.layer, "L2");
  assert.ok(fallbackCalled, "bundledFallback should have been called");
  assert.deepEqual(r.value, { bundled: true });
  assert.equal(putCalled, false, "L2 result must NOT be written back to DDB");
});

// ---------------------------------------------------------------------------
// Contract 5: L3 origin call writes back to L0 + L1
// ---------------------------------------------------------------------------
test("L3 origin call writes back to L0 and L1", async () => {
  clearMemoryCache();

  const now = () => 1_000_000;
  const puts = [];

  const ddb = mockDdb({ getItem: null, puts }); // DDB miss

  const r = await withCache({
    pk: "l3-test",
    sk: "v1",
    ttlSeconds: 300,
    fetchOrigin: async () => ({ fresh: true }),
    source: "origin-src",
    ddbClient: ddb,
    now,
  });

  assert.equal(r.layer, "L3");
  assert.deepEqual(r.value, { fresh: true });
  assert.equal(puts.length, 1, "value should be written to DDB (L1)");
  assert.deepEqual(puts[0].Item.payload, { fresh: true });
  assert.equal(puts[0].Item.source, "origin-src");

  // Verify L0 was warmed: next call with same pk+sk should be L0
  const r2 = await withCache({
    pk: "l3-test",
    sk: "v1",
    ttlSeconds: 300,
    fetchOrigin: async () => {
      throw new Error("should not be called — L0 should be warm");
    },
    source: "origin-src",
    ddbClient: mockDdb({ getItem: null }), // fresh mock with no item
    now,
  });

  assert.equal(r2.layer, "L0", "L0 should have been warmed by the L3 write");
});

// ---------------------------------------------------------------------------
// Contract 6: durationMs is always a non-negative number
// ---------------------------------------------------------------------------
test("durationMs is always a non-negative number on every layer", async () => {
  // --- L3 ---
  clearMemoryCache();
  let tick = 0;
  const now = () => tick++;

  const ddbMiss = mockDdb({ getItem: null });

  const r3 = await withCache({
    pk: "dur-l3",
    sk: "v1",
    ttlSeconds: 300_000, // large enough that L0 won't expire as tick grows
    fetchOrigin: async () => "data",
    source: "test",
    ddbClient: ddbMiss,
    now,
  });
  assert.equal(r3.layer, "L3");
  assert.ok(typeof r3.durationMs === "number", "durationMs must be a number");
  assert.ok(r3.durationMs >= 0, "durationMs must be >= 0");

  // --- L0 (warmed from the L3 call above) ---
  const r0 = await withCache({
    pk: "dur-l3",
    sk: "v1",
    ttlSeconds: 300_000,
    fetchOrigin: async () => {
      throw new Error("should not be called");
    },
    source: "test",
    ddbClient: ddbMiss,
    now,
  });
  assert.equal(r0.layer, "L0");
  assert.ok(typeof r0.durationMs === "number");
  assert.ok(r0.durationMs >= 0);

  // --- L1 ---
  clearMemoryCache();
  const expiresAt = Math.floor((tick + 300_000_000) / 1000);
  const ddbHit = {
    send(cmd) {
      if (cmd instanceof GetCommand)
        return Promise.resolve({
          Item: {
            pk: "dur-l1",
            sk: "v1",
            payload: "cached",
            cachedAt: new Date(tick).toISOString(),
            expiresAt,
            source: "test",
          },
        });
      return Promise.resolve({});
    },
  };
  const r1 = await withCache({
    pk: "dur-l1",
    sk: "v1",
    ttlSeconds: 300,
    fetchOrigin: async () => {
      throw new Error("should not be called on L1 hit");
    },
    source: "test",
    ddbClient: ddbHit,
    now,
  });
  assert.equal(r1.layer, "L1");
  assert.ok(typeof r1.durationMs === "number");
  assert.ok(r1.durationMs >= 0);

  // --- L2 ---
  clearMemoryCache();
  const r2 = await withCache({
    pk: "dur-l2",
    sk: "v1",
    ttlSeconds: 300,
    fetchOrigin: async () => {
      throw new Error("should not be called when L2 covers");
    },
    bundledFallback: async () => "bundled-data",
    source: "test",
    ddbClient: { send: () => Promise.reject(new Error("ddb down")) },
    now,
  });
  assert.equal(r2.layer, "L2");
  assert.ok(typeof r2.durationMs === "number");
  assert.ok(r2.durationMs >= 0);
});
