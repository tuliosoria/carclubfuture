/**
 * Unit tests for scripts/_lib/reddit.mjs
 *
 * No real HTTP calls — uses an injected fake fetch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchRedditMentions } from "../../scripts/_lib/reddit.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePost(sub, i) {
  return {
    subreddit: sub,
    title: `Title ${i}`,
    selftext: `Selftext ${i}`,
    score: i * 10,
    created_utc: 1_700_000_000 + i,
    permalink: `/r/${sub}/comments/${i}/`,
  };
}

/**
 * Build a fake fetch that returns configured data per subreddit.
 * subsData: { [subName]: post[] | number (HTTP status) }
 */
function makeFakeFetch(subsData) {
  return async (url) => {
    const match = url.match(/\/r\/([^/]+)\/search/);
    const sub = match?.[1];
    const config = subsData[sub];

    if (typeof config === "number") {
      return { ok: config >= 200 && config < 300, status: config, json: async () => ({}) };
    }

    if (!config) {
      return { ok: false, status: 404, json: async () => ({}) };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { children: config.map((p) => ({ data: p })) },
      }),
    };
  };
}

// ---------------------------------------------------------------------------
// Test 1: 2 subs × 3 posts each → totalMentions: 6, posts.length: 6
// ---------------------------------------------------------------------------
test("2 subs × 3 posts each → totalMentions 6", async () => {
  const fakeFetch = makeFakeFetch({
    classiccars: [makePost("classiccars", 1), makePost("classiccars", 2), makePost("classiccars", 3)],
    cars: [makePost("cars", 4), makePost("cars", 5), makePost("cars", 6)],
  });

  const result = await fetchRedditMentions("1969 Chevrolet Camaro", {
    fetch: fakeFetch,
    subs: ["classiccars", "cars"],
  });

  assert.equal(result.totalMentions, 6, "totalMentions should be 6");
  assert.equal(result.posts.length, 6, "posts array length should be 6");
  assert.equal(result.posts[0].subreddit, "classiccars");
  assert.equal(result.posts[3].subreddit, "cars");
});

// ---------------------------------------------------------------------------
// Test 2: 429 on one sub — skip it, return posts from other sub
// ---------------------------------------------------------------------------
test("skips sub returning 429 without crashing", async () => {
  const fakeFetch = makeFakeFetch({
    classiccars: 429,
    cars: [makePost("cars", 1)],
  });

  const result = await fetchRedditMentions("test query", {
    fetch: fakeFetch,
    subs: ["classiccars", "cars"],
  });

  assert.equal(result.totalMentions, 1, "only the 1 post from non-blocked sub");
  assert.equal(result.posts[0].subreddit, "cars");
});

// ---------------------------------------------------------------------------
// Test 3: 403 on one sub — same behaviour as 429
// ---------------------------------------------------------------------------
test("skips sub returning 403 without crashing", async () => {
  const fakeFetch = makeFakeFetch({
    classiccars: 403,
    cars: [makePost("cars", 1), makePost("cars", 2)],
  });

  const result = await fetchRedditMentions("test query", {
    fetch: fakeFetch,
    subs: ["classiccars", "cars"],
  });

  assert.equal(result.totalMentions, 2);
});

// ---------------------------------------------------------------------------
// Test 4: ALL subs fail → { totalMentions: 0, posts: [] }
// ---------------------------------------------------------------------------
test("returns empty result when all subs fail (403)", async () => {
  const fakeFetch = async () => ({ ok: false, status: 403, json: async () => ({}) });

  const result = await fetchRedditMentions("test query", {
    fetch: fakeFetch,
    subs: ["classiccars", "cars", "whatisthiscar", "carporn"],
  });

  assert.equal(result.totalMentions, 0);
  assert.equal(result.posts.length, 0);
});

// ---------------------------------------------------------------------------
// Test 5: fetch throws (network error) → logs warning, skips sub
// ---------------------------------------------------------------------------
test("skips sub when fetch throws a network error", async () => {
  let calls = 0;
  const fakeFetch = async (url) => {
    calls++;
    if (url.includes("classiccars")) throw new Error("ECONNREFUSED");
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { children: [{ data: makePost("cars", 1) }] } }),
    };
  };

  const result = await fetchRedditMentions("test", {
    fetch: fakeFetch,
    subs: ["classiccars", "cars"],
  });

  assert.equal(result.totalMentions, 1, "should have the 1 post from the working sub");
  assert.equal(calls, 2, "should have attempted both subs");
});
