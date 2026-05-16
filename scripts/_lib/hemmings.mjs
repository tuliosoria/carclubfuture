/**
 * Hemmings forum thread count — best-effort scrape with graceful degradation.
 *
 * Hemmings frequently returns 403/429; those are treated as "blocked" (not errors)
 * so the pipeline can continue without crashing.
 */
import { jsonLog } from "./http.mjs";

/**
 * Fetch the number of forum threads matching a make+model on Hemmings.
 *
 * @param {string} make
 * @param {string} model
 * @param {object} [opts]
 * @param {function} [opts.fetch] fetch implementation (injectable for tests)
 * @returns {Promise<{ count: number, status: "ok"|"blocked"|"error", error?: string }>}
 */
export async function fetchHemmingsThreadCount(
  make,
  model,
  { fetch: fetchFn = global.fetch } = {},
) {
  try {
    const url = `https://www.hemmings.com/forum/search?q=${encodeURIComponent(`${make} ${model}`)}`;
    const res = await fetchFn(url, {
      headers: { "User-Agent": "CarClubFuture/1.0" },
    });

    if (res.status === 403 || res.status === 429) {
      jsonLog({ operation: "hemmings", make, model, status: res.status, warning: "blocked" });
      return { count: 0, status: "blocked" };
    }

    if (!res.ok) {
      jsonLog({ operation: "hemmings", make, model, status: res.status, warning: "non-OK response" });
      return { count: 0, status: "error" };
    }

    const html = await res.text();
    // Best-effort: count /threads/ occurrences as a proxy for thread count
    const matches = html.match(/\/threads\//g) || [];
    return { count: matches.length, status: "ok" };
  } catch (err) {
    jsonLog({ operation: "hemmings", make, model, warning: "fetch exception", error: String(err) });
    return { count: 0, status: "error", error: String(err) };
  }
}
