/**
 * Unit tests for scripts/sync-oldcarsdata-prices.mjs
 *
 * Tests the syncCars() inner loop via ddbClient / fetchSlug injection.
 * No real AWS calls or HTTP requests are made.
 *
 * Required passing tests:
 *   1. Cache hit (L1) short-circuits API call
 *   2. Bundled fallback (L2) when DynamoDB is unreachable
 *   3. L3 full miss fetches origin and writes back to DynamoDB
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import { clearMemoryCache } from "../../scripts/_lib/cache.mjs";
import { syncCars } from "../../scripts/sync-oldcarsdata-prices.mjs";

/**
 * Build a fake DynamoDBDocumentClient.
 *
 * @param {object} opts
 * @param {object|null} opts.getItem   Item to return from GetCommand (null = miss)
 * @param {Error|null}  opts.getError  If set, GetCommand rejects with this error
 * @param {Array}       opts.puts      Mutable array that collects PutCommand inputs
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
// Test 1: Cache hit (L1) short-circuits the OldCarsData API
// ---------------------------------------------------------------------------
test("cache hit short-circuits API call", async () => {
  clearMemoryCache();

  const cachedRow = {
    asOf: "2024-06-01T00:00:00.000Z",
    conditionAnchor: 3,
    valueUsd: 25000,
    auctionMedian12moUsd: 25000,
    auctionCount12mo: 5,
    reserveMetRate12mo: null,
  };

  // expiresAt well into the future in epoch-seconds so the L1 record is always fresh
  const expiresAt = Math.floor(Date.now() / 1000) + 48 * 3600 * 2;

  const ddb = mockDdb({
    getItem: {
      pk: "oldcarsdata#porsche-911-1973",
      sk: "v1",
      payload: cachedRow,
      cachedAt: "2024-06-01T00:00:00.000Z",
      expiresAt,
      source: "oldcarsdata",
    },
  });

  let apiCalled = false;
  const fetchSlug = async () => {
    apiCalled = true;
    return { ok: true, body: { data: [] }, remaining: 9, reset: null };
  };

  const cars = [{ slug: "porsche-911-1973", year: 1973, make: "Porsche", model: "911" }];

  const result = await syncCars({
    cars,
    apiKey: "test-key",
    existingPrices: {},
    ddbClient: ddb,
    fetchSlug,
  });

  assert.equal(apiCalled, false, "OldCarsData API must NOT be called on a cache hit");
  assert.deepEqual(result.prices["porsche-911-1973"], cachedRow, "prices should reflect the cached row");
  assert.equal(result.ok, 1);
  assert.equal(result.failed, 0);
});

// ---------------------------------------------------------------------------
// Test 2: Bundled fallback (L2) when DynamoDB is unreachable
// ---------------------------------------------------------------------------
test("bundled fallback when DynamoDB is unreachable", async () => {
  clearMemoryCache();

  const bundledRow = {
    asOf: "2024-01-01T00:00:00.000Z",
    conditionAnchor: 3,
    valueUsd: 22000,
    auctionMedian12moUsd: 22000,
    auctionCount12mo: 3,
    reserveMetRate12mo: null,
  };

  const ddb = mockDdb({ getError: new Error("DynamoDB unreachable") });

  let apiCalled = false;
  const fetchSlug = async () => {
    apiCalled = true;
    return { ok: true, body: { data: [] }, remaining: 9, reset: null };
  };

  const cars = [{ slug: "ford-mustang-1969", year: 1969, make: "Ford", model: "Mustang" }];
  const existingPrices = { "ford-mustang-1969": bundledRow };

  const result = await syncCars({
    cars,
    apiKey: "test-key",
    existingPrices,
    ddbClient: ddb,
    fetchSlug,
  });

  assert.equal(apiCalled, false, "OldCarsData API must NOT be called when bundled fallback is available");
  assert.deepEqual(result.prices["ford-mustang-1969"], bundledRow, "bundled row should be served as-is");
  assert.equal(result.ok, 1);
  assert.equal(result.failed, 0);
});

// ---------------------------------------------------------------------------
// Test 3: L3 full miss — origin is fetched and result is written back to DDB
// ---------------------------------------------------------------------------
test("L3 fetch writes result back to DynamoDB", async () => {
  clearMemoryCache();

  const puts = [];
  const ddb = mockDdb({ getItem: null, puts }); // DDB miss

  const snapBody = {
    data: [
      { price: 30000, has_reserve: false, status: "sold" },
      { price: 32000, has_reserve: false, status: "sold" },
    ],
  };

  let apiCalled = false;
  const fetchSlug = async () => {
    apiCalled = true;
    return { ok: true, body: snapBody, remaining: 8, reset: null };
  };

  const cars = [{ slug: "chevrolet-corvette-1967", year: 1967, make: "Chevrolet", model: "Corvette" }];

  const result = await syncCars({
    cars,
    apiKey: "test-key",
    existingPrices: {},
    ddbClient: ddb,
    fetchSlug,
  });

  assert.equal(apiCalled, true, "OldCarsData API MUST be called on a full cache miss");
  assert.equal(puts.length, 1, "PutCommand must be called to write L3 result back to DynamoDB");
  assert.equal(puts[0].Item.pk, "oldcarsdata#chevrolet-corvette-1967");
  assert.equal(puts[0].Item.sk, "v1");
  assert.equal(puts[0].Item.source, "oldcarsdata");
  assert.ok(result.prices["chevrolet-corvette-1967"] != null, "price row should be present");
  assert.equal(result.prices["chevrolet-corvette-1967"].valueUsd, 31000, "median of 30000 and 32000 is 31000");
  assert.equal(result.ok, 1);
  assert.equal(result.failed, 0);
});
