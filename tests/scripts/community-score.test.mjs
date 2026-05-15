/**
 * Unit tests for scripts/build-community-score.mjs
 *
 * Uses injected dependencies — no real AWS, HTTP, or Python subprocess calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import { clearMemoryCache } from "../../scripts/_lib/cache.mjs";
import { buildCommunityScores } from "../../scripts/build-community-score.mjs";

// ---------------------------------------------------------------------------
// DynamoDB mock helpers
// ---------------------------------------------------------------------------

function mockDdbMiss({ puts = [] } = {}) {
  return {
    send(cmd) {
      if (cmd instanceof GetCommand) return Promise.resolve({ Item: undefined });
      if (cmd instanceof PutCommand) {
        puts.push(cmd.input);
        return Promise.resolve({});
      }
      return Promise.resolve({});
    },
  };
}

function mockDdbHit(payload) {
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // far future
  return {
    send(cmd) {
      if (cmd instanceof GetCommand) {
        return Promise.resolve({
          Item: {
            pk: cmd.input.Key.pk,
            sk: cmd.input.Key.sk,
            payload,
            cachedAt: new Date().toISOString(),
            expiresAt,
            source: "community-score",
          },
        });
      }
      return Promise.resolve({});
    },
  };
}

// ---------------------------------------------------------------------------
// Fixed test car
// ---------------------------------------------------------------------------
const TEST_CAR = { slug: "1969-chevrolet-camaro-z-28", year: 1969, make: "Chevrolet", model: "Camaro" };

// ---------------------------------------------------------------------------
// Test 1: Composite score math — known inputs → expected weighted sum
//
// redditMentions = 50  → redditNorm  = 50/100  = 0.5  → * 0.35 * 100 = 17.5
// vaderCompound  = 0.5 → vaderNorm   = (0.5+1)/2 = 0.75 → * 0.25 * 100 = 18.75
// trendsScore30d = 60  → trendsNorm  = 60/100  = 0.6  → * 0.25 * 100 = 15.0
// hemmingsCount  = 25  → hemmingsNorm = 25/50  = 0.5  → * 0.15 * 100 = 7.5
// Total = 58.75 → toFixed(1) → 58.8
// ---------------------------------------------------------------------------
test("composite score math: known inputs produce expected weighted sum", async () => {
  clearMemoryCache();

  const puts = [];
  const ddb = mockDdbMiss({ puts });

  const fakeReddit = async () => ({
    totalMentions: 50,
    posts: [
      { subreddit: "classiccars", title: "Great car!", selftext: "Amazing machine.", score: 10, created_utc: 1, permalink: "/r/x/1" },
    ],
  });

  // vader returns 0.5 compound for all texts → isFallback: false
  const fakeVader = async (texts) => ({
    scores: texts.map(() => ({ compound: 0.5, pos: 0.4, neg: 0.1, neu: 0.5 })),
    isFallback: false,
  });

  const fakeTrends = async () => ({ score30d: 60, momentum90d: 0.2, raw: [] });

  const fakeHemmings = async () => ({ count: 25, status: "ok" });

  const result = await buildCommunityScores({
    ddbClient: ddb,
    cars: [TEST_CAR],
    redditFn: fakeReddit,
    trendsFn: fakeTrends,
    hemmingsFn: fakeHemmings,
    vaderFn: fakeVader,
  });

  const entry = result[TEST_CAR.slug];
  assert.ok(entry, "result should have an entry for the car slug");
  assert.equal(entry.community_score, 58.8, "weighted composite score should be 58.8");
  assert.equal(entry.data_status, "ok", "data_status should be ok (4 data points)");
  assert.equal(entry.data_points, 4, "all 4 sources contributed data");
  assert.equal(entry.sentiment_source, "vader", "should use real VADER, not fallback");
  assert.equal(entry.components.reddit.totalMentions, 50);
  assert.equal(entry.components.trends.score30d, 60);
  assert.equal(entry.components.hemmings.count, 25);
  assert.equal(puts.length, 1, "result should be written to DynamoDB");
});

// ---------------------------------------------------------------------------
// Test 2: Insufficient data — 3 of 4 sources fail → data_status: "insufficient"
//
// Reddit: 403 → 0 mentions → no texts → sentiment fallback
// Trends: throws error → score30d null
// Hemmings: blocked → status "blocked"
// Only Trends succeeds (score30d = 50) → data_points = 1 < 2 → insufficient
// ---------------------------------------------------------------------------
test("data_status: insufficient when only 1 source provides data", async () => {
  clearMemoryCache();

  const ddb = mockDdbMiss();

  // Reddit returns empty (as if all subs were 403)
  const fakeReddit = async () => ({ totalMentions: 0, posts: [] });

  // Vader called with no texts (reddit gave nothing) — will be fallback by default
  // (vaderFn won't be invoked because texts.length === 0)
  const fakeVader = async () => ({ scores: [], isFallback: true });

  // Trends succeeds with a score
  const fakeTrends = async () => ({ score30d: 50, momentum90d: 0.1, raw: [] });

  // Hemmings blocked
  const fakeHemmings = async () => ({ count: 0, status: "blocked" });

  const result = await buildCommunityScores({
    ddbClient: ddb,
    cars: [TEST_CAR],
    redditFn: fakeReddit,
    trendsFn: fakeTrends,
    hemmingsFn: fakeHemmings,
    vaderFn: fakeVader,
  });

  const entry = result[TEST_CAR.slug];
  assert.ok(entry, "should still produce an entry even on mostly-failed sources");
  assert.equal(entry.data_status, "insufficient", "should flag insufficient data");
  assert.equal(entry.data_points, 1, "only Trends succeeded → 1 data point");
  assert.equal(entry.sentiment_source, "fallback", "sentiment should be fallback (no reddit posts)");
});

// ---------------------------------------------------------------------------
// Test 3: Cache hit — DynamoDB returns a fresh entry → source helpers never called
// ---------------------------------------------------------------------------
test("cache hit: source helpers are never called when DynamoDB has a fresh entry", async () => {
  clearMemoryCache();

  const cachedPayload = {
    community_score: 72.5,
    data_status: "ok",
    data_points: 4,
    sentiment_source: "vader",
    components: {
      reddit: { totalMentions: 80, postCount: 80 },
      sentiment: { avgCompound: 0.6, source: "vader" },
      trends: { score30d: 70, momentum90d: 0.3 },
      hemmings: { count: 30, status: "ok" },
    },
    computed_at: new Date().toISOString(),
  };

  const ddb = mockDdbHit(cachedPayload);

  let redditCalled = false;
  let trendsCalled = false;
  let hemmingsCalled = false;
  let vaderCalled = false;

  const result = await buildCommunityScores({
    ddbClient: ddb,
    cars: [TEST_CAR],
    redditFn: async () => { redditCalled = true; return { totalMentions: 0, posts: [] }; },
    trendsFn: async () => { trendsCalled = true; return { score30d: null, momentum90d: null, raw: [] }; },
    hemmingsFn: async () => { hemmingsCalled = true; return { count: 0, status: "error" }; },
    vaderFn: async () => { vaderCalled = true; return { scores: [], isFallback: true }; },
  });

  assert.equal(redditCalled, false, "Reddit should NOT be called on cache hit");
  assert.equal(trendsCalled, false, "Trends should NOT be called on cache hit");
  assert.equal(hemmingsCalled, false, "Hemmings should NOT be called on cache hit");
  assert.equal(vaderCalled, false, "VADER should NOT be called on cache hit");

  const entry = result[TEST_CAR.slug];
  assert.equal(entry.community_score, cachedPayload.community_score, "should return cached score");
  assert.equal(entry.data_status, "ok");
});

// ---------------------------------------------------------------------------
// Test 4: Hemmings failure (throws) is caught gracefully
// ---------------------------------------------------------------------------
test("hemmings exception is caught and treated as error status", async () => {
  clearMemoryCache();

  const ddb = mockDdbMiss();

  const result = await buildCommunityScores({
    ddbClient: ddb,
    cars: [TEST_CAR],
    redditFn: async () => ({ totalMentions: 20, posts: [{ subreddit: "cars", title: "Cool car", selftext: "", score: 5, created_utc: 1, permalink: "/r/cars/1" }] }),
    trendsFn: async () => ({ score30d: 40, momentum90d: 0.1, raw: [] }),
    hemmingsFn: async () => { throw new Error("ECONNREFUSED"); },
    vaderFn: async (texts) => ({ scores: texts.map(() => ({ compound: 0.2, pos: 0.3, neg: 0.1, neu: 0.6 })), isFallback: false }),
  });

  const entry = result[TEST_CAR.slug];
  assert.ok(entry, "should produce an entry even when Hemmings throws");
  assert.equal(entry.components.hemmings.status, "error");
  // data_points: reddit (20>0)=1, vader=1, trends=1, hemmings=0 → 3 → "ok"
  assert.equal(entry.data_status, "ok");
});

// ---------------------------------------------------------------------------
// Test 5: VADER fallback — sidecar fails → neutral scores, sentinel_source: "fallback"
// ---------------------------------------------------------------------------
test("VADER fallback used when sidecar returns isFallback:true", async () => {
  clearMemoryCache();

  const ddb = mockDdbMiss();

  const result = await buildCommunityScores({
    ddbClient: ddb,
    cars: [TEST_CAR],
    redditFn: async () => ({
      totalMentions: 10,
      posts: [{ subreddit: "cars", title: "Nice", selftext: "wow", score: 5, created_utc: 1, permalink: "/r/cars/1" }],
    }),
    trendsFn: async () => ({ score30d: 30, momentum90d: 0, raw: [] }),
    hemmingsFn: async () => ({ count: 5, status: "ok" }),
    vaderFn: async () => ({ scores: [{ compound: 0, pos: 0.33, neg: 0.33, neu: 0.34 }], isFallback: true }),
  });

  const entry = result[TEST_CAR.slug];
  assert.equal(entry.sentiment_source, "fallback", "sentiment_source should be fallback");
  // data_points: reddit=1, vader(fallback)=0, trends=1, hemmings=1 → 3 → ok
  assert.equal(entry.data_status, "ok");
});
