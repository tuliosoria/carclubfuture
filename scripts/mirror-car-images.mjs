#!/usr/bin/env node
/**
 * mirror-car-images.mjs
 *
 * Wikimedia Commons image sync for the catalog.
 *
 * For every catalog vehicle without a local mirrored image:
 *   1. Search Commons for "<year> <make> <model>"
 *   2. Resolve a reasonable thumbnail URL + extmetadata
 *   3. Mirror the bytes to public/cars/<slug>.<ext>
 *   4. Record { url, source: "wikimedia", sourcePageUrl, license, author }
 *      in src/lib/data/cars-ml/oldcarsdata-auction-images.json
 *
 * Attribution: license + author are extracted from extmetadata
 * (LicenseShortName + Artist). They MUST be rendered next to every image
 * to comply with CC-BY / CC-BY-SA licensing.
 *
 * Throttled to 1 req/s (search + image bytes share the bucket).
 */
import { readFile, writeFile, mkdir, access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname } from "node:path";

import { fetchWithRetry, RateLimiter, writeJsonAtomic, jsonLog, timed } from "./_lib/http.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const IMAGES_JSON = resolve(ROOT, "src/lib/data/cars-ml/oldcarsdata-auction-images.json");
const OUT_DIR = resolve(ROOT, "public/cars");

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const UA = "CarClubFuture/1.0 (+https://carclubfuture.com)";
const THUMB_WIDTH = 1200;

const limiter = new RateLimiter(1);

async function exists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

function stripHtml(s) {
  return s ? s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : null;
}

async function searchCommons(query) {
  await limiter.take();
  const u = new URL(COMMONS_API);
  u.searchParams.set("action", "query");
  u.searchParams.set("format", "json");
  u.searchParams.set("origin", "*");
  u.searchParams.set("generator", "search");
  u.searchParams.set("gsrsearch", `${query} filetype:bitmap`);
  u.searchParams.set("gsrnamespace", "6"); // File: namespace
  u.searchParams.set("gsrlimit", "5");
  u.searchParams.set("prop", "imageinfo");
  u.searchParams.set("iiprop", "url|extmetadata|mime");
  u.searchParams.set("iiurlwidth", String(THUMB_WIDTH));
  const r = await fetchWithRetry(u.toString(), { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`commons search ${r.status}`);
  const j = await r.json();
  const pages = j?.query?.pages ? Object.values(j.query.pages) : [];
  // Pick first page with imageinfo + a non-SVG, photo-like mime
  for (const p of pages) {
    const info = p?.imageinfo?.[0];
    if (!info?.url) continue;
    const mime = info.mime || "";
    if (!/^image\/(jpeg|png|webp)$/i.test(mime)) continue;
    return { page: p, info };
  }
  return null;
}

function extractAttribution(info) {
  const meta = info.extmetadata || {};
  const license = meta.LicenseShortName?.value || meta.License?.value || "Unknown";
  const author = stripHtml(meta.Artist?.value) || "Unknown";
  const credit = stripHtml(meta.Credit?.value) || null;
  const requiresAttribution = String(meta.AttributionRequired?.value || "").toLowerCase() === "true"
    || /^cc[- ]by/i.test(license);
  return { license, author, credit, requiresAttribution };
}

async function mirrorBytes(url, dest) {
  await limiter.take();
  const r = await fetchWithRetry(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`mirror ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(dest, buf);
  const st = await stat(dest);
  return st.size;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  const cars = Array.isArray(catalogFile) ? catalogFile : (catalogFile.vehicles ?? []);

  /** @type {Record<string, {url:string, source:"wikimedia", sourcePageUrl:string, license:string, author:string, mirroredAt:string}>} */
  let images = {};
  if (await exists(IMAGES_JSON)) {
    try { images = JSON.parse(await readFile(IMAGES_JSON, "utf8")); } catch { images = {}; }
  }

  const result = await timed("mirror:images", async () => {
    let ok = 0, failed = 0, skipped = 0;
    for (const c of cars) {
      const slug = c.slug;
      // Skip if we already have a local mirror AND a recorded attribution.
      const existing = images[slug];
      const localGuess = existing?.url ? resolve(ROOT, "public" + existing.url) : null;
      if (existing && localGuess && (await exists(localGuess))) { skipped++; continue; }

      const query = `${c.year} ${c.make} ${c.model}`.trim();
      try {
        const hit = await searchCommons(query);
        if (!hit) { failed++; jsonLog({ operation:"commons.miss", slug, query }); continue; }
        const { info } = hit;
        const sourceUrl = info.thumburl || info.url;
        const ext = (extname(new URL(info.url).pathname) || ".jpg").toLowerCase();
        const dest = resolve(OUT_DIR, `${slug}${ext}`);
        const bytes = await mirrorBytes(sourceUrl, dest);
        const attr = extractAttribution(info);
        images[slug] = {
          url: `/cars/${slug}${ext}`,
          source: "wikimedia",
          sourcePageUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(info.url.split("/").pop())}`,
          license: attr.license,
          author: attr.author,
          mirroredAt: new Date().toISOString(),
        };
        ok++;
        jsonLog({ operation:"commons.mirrored", slug, bytes, license: attr.license });
      } catch (err) {
        failed++;
        jsonLog({ operation:"commons.error", slug, error: err });
      }
    }
    await writeJsonAtomic(IMAGES_JSON, images);
    return { recordsProcessed: cars.length, ok, failed, skipped };
  });

  jsonLog({ operation:"mirror:images.summary", ...result });
}

main().catch((err) => {
  jsonLog({ operation:"mirror:images.fatal", error: err });
  process.exit(1);
});
