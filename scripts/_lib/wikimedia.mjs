/**
 * Pure Wikimedia Commons image search + selection helpers.
 *
 * All functions are side-effect-free except `searchVehicleImages` which
 * accepts injected `fetch` and `rateLimiter` so it remains unit-testable.
 */

export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const UA = "CarClubFuture/1.0 (https://carclubfuture.com; hello@carclubfuture.com) Node/22";

// Titles containing these substrings are rejected (we want full vehicle shots).
const REJECT_TITLE_KEYWORDS = ["interior", "engine", "logo"];

// Minimum acceptable image width (pixels).
const MIN_WIDTH = 800;

/**
 * Query Wikimedia Commons for images of a vehicle.
 *
 * @param {object} opts
 * @param {number}   opts.year
 * @param {string}   opts.make
 * @param {string}   opts.model
 * @param {function} [opts.fetch]       Injected fetch (defaults to globalThis.fetch)
 * @param {object}   [opts.rateLimiter] Object with `.take()` method; called before request
 * @returns {Promise<Array<{url,width,height,mime,license,licenseUrl,author,title}>>}
 */
export async function searchVehicleImages({ year, make, model, fetch: fetchFn, rateLimiter }) {
  const fn = fetchFn ?? globalThis.fetch;
  if (rateLimiter) await rateLimiter.take();

  const u = new URL(COMMONS_API);
  u.searchParams.set("action", "query");
  u.searchParams.set("generator", "search");
  u.searchParams.set("gsrsearch", `${year} ${make} ${model} filetype:bitmap`);
  u.searchParams.set("gsrnamespace", "6"); // File: namespace
  u.searchParams.set("gsrlimit", "10");
  u.searchParams.set("prop", "imageinfo");
  u.searchParams.set("iiprop", "url|extmetadata|dimensions|mime|size");
  u.searchParams.set("format", "json");
  u.searchParams.set("origin", "*");

  const r = await fn(u.toString(), { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`wikimedia search HTTP ${r.status}`);
  const j = await r.json();

  const pages = j?.query?.pages ? Object.values(j.query.pages) : [];
  const results = [];

  for (const p of pages) {
    const info = p?.imageinfo?.[0];
    if (!info?.url) continue;

    const attr = extractAttribution(info.extmetadata);
    results.push({
      url: info.url,
      width: info.width ?? null,
      height: info.height ?? null,
      mime: info.mime ?? null,
      license: attr.license,
      licenseUrl: attr.licenseUrl,
      author: attr.author,
      title: p.title ?? "",
    });
  }

  return results;
}

/**
 * Pick the best image from a set of Wikimedia candidates.
 *
 * Filters: width >= 800, allowed license, title does not contain
 * "interior", "engine", or "logo". Sorts by width DESC.
 *
 * @param {Array} candidates  Array as returned by `searchVehicleImages`
 * @returns {object|null}     Best candidate, or null if none qualify
 */
export function pickBestImage(candidates) {
  if (!candidates || candidates.length === 0) return null;

  const filtered = candidates.filter((c) => {
    if ((c.width ?? 0) < MIN_WIDTH) return false;
    if (!isAllowedLicense(c.license)) return false;
    const titleLower = (c.title || "").toLowerCase();
    if (REJECT_TITLE_KEYWORDS.some((k) => titleLower.includes(k))) return false;
    return true;
  });

  if (filtered.length === 0) return null;

  filtered.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return filtered[0];
}

/**
 * Extract attribution fields from Wikimedia extmetadata.
 *
 * Always returns populated strings — never null/undefined fields.
 *
 * @param {object|null|undefined} extmetadata  Wikimedia extmetadata object
 * @returns {{ author: string, license: string, licenseUrl: string }}
 */
export function extractAttribution(extmetadata) {
  const meta = extmetadata ?? {};
  const val = (key) => meta[key]?.value ?? "";

  const license =
    stripHtml(val("LicenseShortName") || val("License")) || "Unknown";
  const author =
    stripHtml(val("Artist") || val("Author") || val("Credit")) || "Unknown";
  const licenseUrl = val("LicenseUrl") || val("License_Url") || "";

  return { author, license, licenseUrl };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stripHtml(s) {
  if (!s) return "";
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Returns true if the license string represents one of the allowed open licenses.
 * Handles variants like "CC BY-SA 4.0", "CC-BY-SA-4.0", "Public domain", "cc0".
 */
export function isAllowedLicense(license) {
  if (!license) return false;
  const l = license.toUpperCase().replace(/-/g, " ");
  if (l === "CC0" || l === "CC 0") return true;
  if (l.includes("PUBLIC DOMAIN") || l.includes("PUBLICDOMAIN")) return true;
  // CC-BY and CC-BY-SA (all versions) — note: CC BY-NC is NOT allowed
  if (/^CC\s+BY(\s+SA)?(\s+\d|$)/.test(l)) return true;
  return false;
}
