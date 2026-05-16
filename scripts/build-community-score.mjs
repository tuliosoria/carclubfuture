#!/usr/bin/env node
/**
 * build-community-score.mjs  —  Phase D: community signals → composite score
 *
 * Sources (all best-effort, graceful degradation on failure):
 *   1. Reddit JSON API   — mention count across 4 subreddits
 *   2. VADER sentiment   — Python sidecar; falls back to neutral on error
 *   3. Google Trends     — interestOverTime, last 90 days
 *   4. Hemmings forum    — thread count via best-effort scrape
 *
 * Composite score 0–100 (weights sum to 1.00):
 *   0.35 × Reddit mentions  (cap 100 → 100)
 *   0.25 × VADER compound   (-1..1 → 0..100)
 *   0.25 × Trends score30d  (already 0–100)
 *   0.15 × Hemmings count   (cap 50 → 100)
 *
 * Cache: DynamoDB, key = community#<slug>#<yyyymm>, TTL = 7 days
 *
 * Output: src/lib/data/cars-ml/community-score.json
 *
 * Note: Reddit top comments are skipped (each would need a separate
 * /comments/<id>.json call). Only post titles + selftext are analysed.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

import { withCache } from "./_lib/cache.mjs";
import { RateLimiter, writeJsonAtomic, jsonLog } from "./_lib/http.mjs";
import { fetchRedditMentions } from "./_lib/reddit.mjs";
import { fetchTrendScore } from "./_lib/trends.mjs";
import { fetchHemmingsThreadCount } from "./_lib/hemmings.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const OUT = resolve(ROOT, "src/lib/data/cars-ml/community-score.json");

const REDDIT_SUBS = ["classiccars", "cars", "whatisthiscar", "carporn"];
const CACHE_TTL = 7 * 24 * 3600; // 7 days in seconds

/** Zero-padded YYYYMM string for the current (or injected) date. */
const yyyymm = (d = new Date()) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// VADER sidecar
// ---------------------------------------------------------------------------

const VADER_FALLBACK_SCORE = { compound: 0, pos: 0.33, neg: 0.33, neu: 0.34 };

/**
 * Run `texts` through the Python VADER sidecar.
 * Returns `{ scores, isFallback }`.
 * On any error (no python3, missing vaderSentiment) falls back to uniform
 * neutral scores and logs a warning — never throws.
 *
 * @param {string[]} texts
 * @param {object}  [opts]
 * @param {function} [opts.spawnFn]  Injectable child_process.spawn for tests
 */
async function vaderScore(texts, { spawnFn = spawn } = {}) {
  if (!texts || texts.length === 0) return { scores: [], isFallback: true };

  try {
    const scores = await new Promise((resolve, reject) => {
      const proc = spawnFn("python3", ["scripts/_lib/vader_sentiment.py"], {
        stdio: ["pipe", "pipe", "inherit"],
      });
      let out = "";
      proc.stdout.on("data", (chunk) => (out += chunk));
      proc.on("error", reject);
      proc.on("close", (code) =>
        code === 0
          ? resolve(JSON.parse(out))
          : reject(new Error(`vader exited ${code}`)),
      );
      proc.stdin.write(JSON.stringify(texts));
      proc.stdin.end();
    });
    return { scores, isFallback: false };
  } catch (err) {
    jsonLog({
      operation: "vader",
      warning: "sidecar failed — using neutral fallback",
      error: String(err),
    });
    return {
      scores: texts.map(() => ({ ...VADER_FALLBACK_SCORE })),
      isFallback: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Scoring math
// ---------------------------------------------------------------------------

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * Compose the weighted community_score (0–100).
 * Weights: Reddit 0.35 + VADER 0.25 + Trends 0.25 + Hemmings 0.15 = 1.00
 */
function compositeScore({ redditMentions, vaderCompound, trendsScore30d, hemmingsCount }) {
  const redditNorm = clamp01(redditMentions / 100);       // cap: 100 mentions = max
  const vaderNorm = (vaderCompound + 1) / 2;              // -1..1 → 0..1
  const trendsNorm = clamp01((trendsScore30d ?? 0) / 100); // already 0-100
  const hemmingsNorm = clamp01(hemmingsCount / 50);        // cap: 50 threads = max

  const score =
    0.35 * redditNorm * 100 +
    0.25 * vaderNorm * 100 +
    0.25 * trendsNorm * 100 +
    0.15 * hemmingsNorm * 100;

  return Number(score.toFixed(1));
}

// ---------------------------------------------------------------------------
// Per-car origin fetch
// ---------------------------------------------------------------------------

/**
 * Fetch all community signals for a single car and return the composed score.
 * All source failures are caught and logged; the pipeline continues.
 *
 * @param {object} car         { slug, year, make, model }
 * @param {object} [opts]
 * @param {object}   [opts.redditRl]      RateLimiter for Reddit
 * @param {function} [opts.redditFn]      Injectable fetchRedditMentions
 * @param {function} [opts.trendsFn]      Injectable fetchTrendScore
 * @param {function} [opts.hemmingsFn]    Injectable fetchHemmingsThreadCount
 * @param {function} [opts.vaderFn]       Injectable vaderScore (texts) → { scores, isFallback }
 */
async function fetchCommunityData(
  car,
  {
    redditRl,
    redditFn = fetchRedditMentions,
    trendsFn = fetchTrendScore,
    hemmingsFn = fetchHemmingsThreadCount,
    vaderFn = vaderScore,
  } = {},
) {
  const { slug, year, make, model } = car;
  const query = `${year} ${make} ${model}`;

  // ── Reddit ────────────────────────────────────────────────────────────────
  let redditResult = { totalMentions: 0, posts: [] };
  try {
    redditResult = await redditFn(query, {
      rateLimiter: redditRl,
      subs: REDDIT_SUBS,
    });
  } catch (err) {
    jsonLog({ operation: "community", slug, source: "reddit", warning: "failed", error: String(err) });
  }

  // ── VADER sentiment (on post titles + selftext) ───────────────────────────
  const texts = redditResult.posts
    .map((p) => [p.title, p.selftext].filter(Boolean).join(" "))
    .filter((t) => t.trim().length > 0);

  let avgCompound = VADER_FALLBACK_SCORE.compound;
  let sentimentSource = "fallback";

  if (texts.length > 0) {
    const { scores, isFallback } = await vaderFn(texts);
    sentimentSource = isFallback ? "fallback" : "vader";
    if (scores.length > 0) {
      avgCompound = scores.reduce((sum, s) => sum + s.compound, 0) / scores.length;
    }
  }

  // ── Google Trends ─────────────────────────────────────────────────────────
  let trendsResult = { score30d: null, momentum90d: null, raw: [] };
  try {
    trendsResult = await trendsFn(query);
  } catch (err) {
    jsonLog({ operation: "community", slug, source: "trends", warning: "failed", error: String(err) });
  }

  // ── Hemmings ──────────────────────────────────────────────────────────────
  let hemmingsResult = { count: 0, status: "error" };
  try {
    hemmingsResult = await hemmingsFn(make, model);
  } catch (err) {
    jsonLog({ operation: "community", slug, source: "hemmings", warning: "failed", error: String(err) });
  }

  // ── Data quality ──────────────────────────────────────────────────────────
  const dataPoints =
    (redditResult.totalMentions > 0 ? 1 : 0) +
    (sentimentSource === "vader" ? 1 : 0) +
    (trendsResult.score30d !== null ? 1 : 0) +
    (hemmingsResult.status === "ok" ? 1 : 0);

  const community_score = compositeScore({
    redditMentions: redditResult.totalMentions,
    vaderCompound: avgCompound,
    trendsScore30d: trendsResult.score30d,
    hemmingsCount: hemmingsResult.count,
  });

  return {
    community_score,
    data_status: dataPoints < 2 ? "insufficient" : "ok",
    data_points: dataPoints,
    sentiment_source: sentimentSource,
    components: {
      reddit: {
        totalMentions: redditResult.totalMentions,
        postCount: redditResult.posts.length,
      },
      sentiment: {
        avgCompound,
        source: sentimentSource,
      },
      trends: {
        score30d: trendsResult.score30d,
        momentum90d: trendsResult.momentum90d,
      },
      hemmings: {
        count: hemmingsResult.count,
        status: hemmingsResult.status,
      },
    },
    computed_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Orchestrator (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Build community scores for all cars in the catalog.
 *
 * @param {object} [opts]
 * @param {object}   [opts.ddbClient]    Injectable DynamoDB client
 * @param {Array}    [opts.cars]         Override catalog (for tests)
 * @param {function} [opts.redditFn]     Injectable reddit helper
 * @param {function} [opts.trendsFn]     Injectable trends helper
 * @param {function} [opts.hemmingsFn]   Injectable hemmings helper
 * @param {function} [opts.vaderFn]      Injectable vader scorer
 * @returns {Promise<Record<string, object>>}  slug → community score object
 */
export async function buildCommunityScores({
  ddbClient,
  cars: carsOverride,
  redditFn = fetchRedditMentions,
  trendsFn = fetchTrendScore,
  hemmingsFn = fetchHemmingsThreadCount,
  vaderFn = vaderScore,
} = {}) {
  let cars = carsOverride;
  if (!cars) {
    const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
    cars = Array.isArray(catalogFile) ? catalogFile : catalogFile.vehicles ?? [];
  }

  const redditRl = new RateLimiter(1); // 1 req/s — Reddit enforced throttle
  const out = {};

  for (const car of cars) {
    const { slug } = car;
    const pk = `community#${slug}#${yyyymm()}`;

    const { value } = await withCache({
      pk,
      sk: "v1",
      ttlSeconds: CACHE_TTL,
      source: "community-score",
      ...(ddbClient ? { ddbClient } : {}),
      fetchOrigin: () =>
        fetchCommunityData(car, { redditRl, redditFn, trendsFn, hemmingsFn, vaderFn }),
    });

    out[slug] = value;
    jsonLog({
      operation: "community",
      slug,
      score: value.community_score,
      data_status: value.data_status,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// CLI entry point — only runs when executed directly, not when imported
// ---------------------------------------------------------------------------

async function main() {
  const scores = await buildCommunityScores();
  await writeJsonAtomic(OUT, scores);
  jsonLog({ operation: "community:done", recordsProcessed: Object.keys(scores).length });
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith("build-community-score.mjs");

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
