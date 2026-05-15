/**
 * Tiered cache helper: L0 (memory) → L1 (DynamoDB) → L2 (bundled) → L3 (origin)
 *
 * Layer semantics:
 *   L0  In-process Map — fastest, lost on process exit, no AWS cost.
 *   L1  DynamoDB — survives restarts, shared across processes, TTL-managed.
 *   L2  Bundled fallback — static/bundled data served when DynamoDB is unavailable
 *       (throttle, network error). L2 results are NOT written back to DynamoDB
 *       because we can't know whether the bundled data is fresher than what DDB
 *       couldn't tell us.
 *   L3  Origin fetch — live upstream call. On success the result is written to
 *       both L0 and L1 with the configured TTL.
 *
 * fetchOrigin error handling (documented choice):
 *   If fetchOrigin throws and a bundledFallback is provided, we call the fallback
 *   and return L2. If fetchOrigin throws and there is no bundledFallback, the
 *   error propagates to the caller. This means "all four layers failed" only
 *   throws when L0 miss + L1 miss/throws + L2 unavailable + L3 throws.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { jsonLog } from "./http.mjs";

// ---------------------------------------------------------------------------
// L0: in-process memory cache
// Key: "${pk}\x00${sk}" (null-byte separator avoids collisions between pk/sk values)
// Value: { value, expiresAt (ms), cachedAt (ISO string), source }
// ---------------------------------------------------------------------------
const _memCache = new Map();

/** Clear the in-process cache. Intended for tests only. */
export function clearMemoryCache() {
  _memCache.clear();
}

// ---------------------------------------------------------------------------
// Default DynamoDB client — lazy-initialised once per process.
// Tests inject their own via the ddbClient parameter so this is never invoked
// during unit tests.
// ---------------------------------------------------------------------------
let _defaultClient = null;

function getDefaultClient(region) {
  if (!_defaultClient) {
    _defaultClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region }),
      { marshallOptions: { removeUndefinedValues: true } },
    );
  }
  return _defaultClient;
}

// ---------------------------------------------------------------------------
// getCached — direct L0 / L1 lookup (no fallback, no origin).
// Throws if DynamoDB throws (caller must handle).
// ---------------------------------------------------------------------------
/**
 * @param {object} opts
 * @param {string} opts.pk
 * @param {string} [opts.sk="v1"]
 * @param {object} [opts.ddbClient]
 * @param {string} [opts.tableName]
 * @param {string} [opts.region]
 * @returns {{ value, layer: "L0"|"L1", cachedAt, expiresAt } | null}
 */
export async function getCached({
  pk,
  sk = "v1",
  ddbClient,
  tableName = process.env.DYNAMODB_TABLE || "carclubfuture-cache",
  region = process.env.AWS_REGION || "us-east-1",
}) {
  const nowMs = Date.now();
  const memKey = `${pk}\x00${sk}`;

  // L0
  const memEntry = _memCache.get(memKey);
  if (memEntry && memEntry.expiresAt > nowMs) {
    return { value: memEntry.value, layer: "L0", cachedAt: memEntry.cachedAt, expiresAt: memEntry.expiresAt };
  }

  // L1
  const client = ddbClient ?? getDefaultClient(region);
  const result = await client.send(new GetCommand({ TableName: tableName, Key: { pk, sk } }));
  const item = result.Item;
  if (item && item.expiresAt * 1000 > nowMs) {
    return {
      value: item.payload,
      layer: "L1",
      cachedAt: item.cachedAt,
      expiresAt: item.expiresAt * 1000,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// putCached — write a value to L0 and L1.
// ---------------------------------------------------------------------------
/**
 * @param {object} opts
 * @param {string} opts.pk
 * @param {string} [opts.sk="v1"]
 * @param {*}      opts.value
 * @param {number} opts.ttlSeconds
 * @param {string} opts.source
 * @param {object} [opts.ddbClient]
 * @param {string} [opts.tableName]
 * @param {string} [opts.region]
 * @param {function} [opts.now]
 * @returns {Promise<void>}
 */
export async function putCached({
  pk,
  sk = "v1",
  value,
  ttlSeconds,
  source,
  ddbClient,
  tableName = process.env.DYNAMODB_TABLE || "carclubfuture-cache",
  region = process.env.AWS_REGION || "us-east-1",
  now = () => Date.now(),
}) {
  const nowMs = now();
  const expiresAtMs = nowMs + ttlSeconds * 1000;
  const cachedAt = new Date(nowMs).toISOString();
  const memKey = `${pk}\x00${sk}`;

  // Write L0
  _memCache.set(memKey, { value, expiresAt: expiresAtMs, cachedAt, source });

  // Write L1
  const client = ddbClient ?? getDefaultClient(region);
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        pk,
        sk,
        payload: value,
        cachedAt,
        expiresAt: Math.floor(expiresAtMs / 1000),
        source,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// withCache — main entry point for all sync scripts.
// ---------------------------------------------------------------------------
/**
 * @param {object}   opts
 * @param {string}   opts.pk                     DynamoDB partition key
 * @param {string}   [opts.sk="v1"]              DynamoDB sort key
 * @param {number}   opts.ttlSeconds             Positive integer
 * @param {function} opts.fetchOrigin            async () => any — called on full miss
 * @param {function} [opts.bundledFallback=null] async () => any|null — L2 fallback
 * @param {string}   opts.source                 Stored on writes, included in logs
 * @param {string}   [opts.tableName]
 * @param {string}   [opts.region]
 * @param {object}   [opts.ddbClient]            Injected for tests
 * @param {function} [opts.now]                  () => number (ms) — injected for tests
 * @returns {Promise<{ value, layer: "L0"|"L1"|"L2"|"L3", durationMs: number, source: string }>}
 */
export async function withCache({
  pk,
  sk = "v1",
  ttlSeconds,
  fetchOrigin,
  bundledFallback = null,
  source,
  tableName = process.env.DYNAMODB_TABLE || "carclubfuture-cache",
  region = process.env.AWS_REGION || "us-east-1",
  ddbClient,
  now = () => Date.now(),
}) {
  const startMs = now();
  const memKey = `${pk}\x00${sk}`;

  // ── L0: in-process memory ────────────────────────────────────────────────
  const memEntry = _memCache.get(memKey);
  if (memEntry && memEntry.expiresAt > now()) {
    // No log here — L0 hits are too frequent; logging would spam in tight loops.
    return {
      value: memEntry.value,
      layer: "L0",
      durationMs: now() - startMs,
      source: memEntry.source,
    };
  }

  const client = ddbClient ?? getDefaultClient(region);

  // ── L1: DynamoDB ─────────────────────────────────────────────────────────
  let ddbItem = null;
  let ddbError = null;

  try {
    const result = await client.send(new GetCommand({ TableName: tableName, Key: { pk, sk } }));
    ddbItem = result.Item ?? null;
  } catch (err) {
    ddbError = err;
  }

  if (!ddbError && ddbItem && ddbItem.expiresAt * 1000 > now()) {
    // Warm L0 from the L1 record
    const expiresAtMs = ddbItem.expiresAt * 1000;
    _memCache.set(memKey, {
      value: ddbItem.payload,
      expiresAt: expiresAtMs,
      cachedAt: ddbItem.cachedAt,
      source: ddbItem.source,
    });
    const durationMs = now() - startMs;
    jsonLog({ operation: "cache", pk, sk, layer: "L1", durationMs, source: ddbItem.source });
    return { value: ddbItem.payload, layer: "L1", durationMs, source: ddbItem.source };
  }

  // ── L2: bundled fallback (only when DynamoDB itself threw) ────────────────
  if (ddbError && bundledFallback) {
    const fallbackValue = await bundledFallback();
    if (fallbackValue != null) {
      const durationMs = now() - startMs;
      jsonLog({ operation: "cache", pk, sk, layer: "L2", durationMs, source, error: ddbError });
      return { value: fallbackValue, layer: "L2", durationMs, source };
    }
  }

  // ── L3: origin fetch ──────────────────────────────────────────────────────
  let originValue;
  try {
    originValue = await fetchOrigin();
  } catch (originErr) {
    // If a bundledFallback is available, use it as the final safety net.
    // This covers the case where DDB returned a miss/expired (no ddbError)
    // but origin is also down. L2 results are still not written back to DDB.
    if (bundledFallback) {
      const fallbackValue = await bundledFallback();
      if (fallbackValue != null) {
        const durationMs = now() - startMs;
        jsonLog({ operation: "cache", pk, sk, layer: "L2", durationMs, source, error: originErr });
        return { value: fallbackValue, layer: "L2", durationMs, source };
      }
    }
    // All layers exhausted — propagate the origin error.
    jsonLog({ operation: "cache", pk, sk, layer: "L3-error", durationMs: now() - startMs, source, error: originErr });
    throw originErr;
  }

  // Write L3 result back to L0 (memory) immediately…
  const nowMs = now();
  const expiresAtMs = nowMs + ttlSeconds * 1000;
  const cachedAt = new Date(nowMs).toISOString();
  _memCache.set(memKey, { value: originValue, expiresAt: expiresAtMs, cachedAt, source });

  // …and to L1 (DynamoDB). A write failure is logged but must not fail the caller —
  // the value was already fetched successfully.
  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk,
          sk,
          payload: originValue,
          cachedAt,
          expiresAt: Math.floor(expiresAtMs / 1000),
          source,
        },
      }),
    );
  } catch (writeErr) {
    jsonLog({ operation: "cache", pk, sk, layer: "L3-write-error", durationMs: now() - startMs, source, error: writeErr });
  }

  const durationMs = now() - startMs;
  jsonLog({ operation: "cache", pk, sk, layer: "L3", durationMs, source });
  return { value: originValue, layer: "L3", durationMs, source };
}
