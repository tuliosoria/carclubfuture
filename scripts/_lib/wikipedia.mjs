/**
 * Wikipedia pageimages helper.
 *
 * Used as a second-tier fallback after a Wikimedia Commons search misses.
 * Many obscure cars (e.g. "1989 Geo Spectrum") don't have dedicated Commons
 * categories but DO have a Wikipedia article whose pageimage is freely
 * licensed (Wikipedia's text is CC BY-SA 3.0; the image itself may have
 * its own free license, so we label conservatively and link to the article).
 *
 * Public API: fetchWikipediaImage({ year, make, model, fetch, rateLimiter })
 *   → { url, sourcePageUrl, license, author } | null
 */

const API = "https://en.wikipedia.org/w/api.php";
const UA = "CarClubFuture/1.0 (https://carclubfuture.com; hello@carclubfuture.com) Node/22";

/**
 * Query Wikipedia's pageimages endpoint for an article matching the vehicle.
 * Tries `<year> <make> <model>` first, falls back to `<make> <model>`.
 *
 * @param {object}   opts
 * @param {number}   opts.year
 * @param {string}   opts.make
 * @param {string}   opts.model
 * @param {function} [opts.fetch]        Injected fetch (defaults to globalThis.fetch)
 * @param {object}   [opts.rateLimiter]  Object with `.take()` method
 * @param {object}   [opts.counters]     Optional { requests: number } counter, incremented per HTTP call
 * @returns {Promise<{url, sourcePageUrl, license, author, width, height} | null>}
 */
export async function fetchWikipediaImage({ year, make, model, fetch: fetchFn, rateLimiter, counters } = {}) {
  const titles = [
    `${year} ${make} ${model}`,
    `${make} ${model}`,
  ];
  for (const title of titles) {
    const result = await queryPageimage(title, fetchFn, rateLimiter, counters);
    if (result) return result;
  }
  return null;
}

async function queryPageimage(title, fetchFn, rateLimiter, counters) {
  const fn = fetchFn ?? globalThis.fetch;
  if (rateLimiter) await rateLimiter.take();
  if (counters) counters.requests = (counters.requests ?? 0) + 1;

  const u = new URL(API);
  u.searchParams.set("action", "query");
  u.searchParams.set("format", "json");
  u.searchParams.set("prop", "pageimages|pageprops|info");
  u.searchParams.set("piprop", "original|thumbnail");
  u.searchParams.set("pithumbsize", "1200");
  u.searchParams.set("inprop", "url");
  u.searchParams.set("redirects", "1");
  u.searchParams.set("titles", title);
  u.searchParams.set("origin", "*");

  let resp;
  try {
    resp = await fn(u.toString(), { headers: { "User-Agent": UA } });
  } catch {
    return null;
  }
  if (!resp || !resp.ok) return null;

  let j;
  try { j = await resp.json(); } catch { return null; }

  const pages = j?.query?.pages ? Object.values(j.query.pages) : [];
  for (const p of pages) {
    if (!p || p.missing !== undefined) continue;
    const original = p.original || null;
    const thumb = p.thumbnail || null;
    const imgUrl = original?.source || thumb?.source;
    if (!imgUrl) continue;
    const sourcePageUrl = p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title || title)}`;
    return {
      url: imgUrl,
      sourcePageUrl,
      license: "CC BY-SA 3.0",
      author: "Wikipedia contributors",
      width: original?.width ?? thumb?.width ?? null,
      height: original?.height ?? thumb?.height ?? null,
    };
  }
  return null;
}
