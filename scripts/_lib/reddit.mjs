/**
 * Reddit JSON API helper for community signal collection.
 *
 * Uses reddit's public JSON API (no OAuth) with a proper User-Agent.
 * Reddit blocks default/missing UAs — always set User-Agent explicitly.
 */
import { jsonLog } from "./http.mjs";

const REDDIT_BASE = "https://www.reddit.com";
const USER_AGENT = "CarClubFuture/1.0 (community-score)";

/**
 * Fetch Reddit mentions across multiple subreddits.
 *
 * @param {string} query          Search term (e.g. "1969 Chevrolet Camaro")
 * @param {object} opts
 * @param {function} opts.fetch           fetch implementation (injectable for tests)
 * @param {object}  [opts.rateLimiter]   RateLimiter instance, `take()` called before each sub
 * @param {string[]} [opts.subs]          Subreddits to search
 * @returns {Promise<{ totalMentions: number, posts: Array }>}
 *
 * Note: Top comments per post are skipped for budget reasons (each post would require
 * a separate /comments/<id>.json call). Only post titles + selftext are captured.
 */
export async function fetchRedditMentions(
  query,
  {
    fetch: fetchFn = global.fetch,
    rateLimiter,
    subs = ["classiccars", "cars", "whatisthiscar", "carporn"],
  } = {},
) {
  const posts = [];

  for (const sub of subs) {
    if (rateLimiter) await rateLimiter.take();

    const url =
      `${REDDIT_BASE}/r/${sub}/search.json` +
      `?q=${encodeURIComponent(query)}&sort=new&limit=100&restrict_sr=1`;

    try {
      const resp = await fetchFn(url, {
        headers: { "User-Agent": USER_AGENT },
      });

      if (resp.status === 429 || resp.status === 403) {
        jsonLog({
          operation: "reddit",
          sub,
          status: resp.status,
          warning: "rate-limited or blocked — skipping sub",
        });
        continue;
      }

      if (!resp.ok) {
        jsonLog({
          operation: "reddit",
          sub,
          status: resp.status,
          warning: "non-OK response — skipping sub",
        });
        continue;
      }

      const data = await resp.json();
      const children = data?.data?.children ?? [];

      for (const child of children) {
        const p = child.data;
        posts.push({
          subreddit: p.subreddit,
          title: p.title ?? "",
          selftext: p.selftext ?? "",
          score: p.score ?? 0,
          created_utc: p.created_utc ?? 0,
          permalink: p.permalink ?? "",
        });
      }
    } catch (err) {
      jsonLog({
        operation: "reddit",
        sub,
        warning: "fetch exception — skipping sub",
        error: String(err),
      });
    }
  }

  return { totalMentions: posts.length, posts };
}
