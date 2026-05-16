#!/usr/bin/env node
/**
 * sync-bat-history.mjs — gated BaT (Bring a Trailer) historical scraper.
 *
 * Gate: BAT_SCRAPE_ENABLED=1 must be set. Default is OFF.
 *
 * Behaviour when enabled:
 *   1. Read the 12-car slug catalog from src/lib/data/cars-ml/cars-catalog.json
 *   2. For each slug, fetch & cache BaT completed-auction results for the
 *      current month. Cache key: bat-history#<slug>#<yyyymm>, TTL = 30 days.
 *   3. Throttle at 1 request per 3 seconds (polite scraper).
 *   4. Write merged results to src/lib/data/cars-ml/bat-auction-history.json
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { withCache } from "./_lib/cache.mjs";
import { fetchWithRetry, RateLimiter, writeJsonAtomic, jsonLog, timed } from "./_lib/http.mjs";
import { batSearchUrl, parseBatResultsHtml } from "./_lib/bat-parser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// ── Gate ─────────────────────────────────────────────────────────────────────
if (process.env.BAT_SCRAPE_ENABLED !== "1") {
  jsonLog({ operation: "bat.skip", reason: "disabled" });
  process.exit(0);
}

// ── Config ────────────────────────────────────────────────────────────────────
const CATALOG_PATH   = join(REPO_ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const OUTPUT_PATH    = join(REPO_ROOT, "src/lib/data/cars-ml/bat-auction-history.json");
const TTL_SECONDS    = 30 * 24 * 3600; // 30 days
const BAT_USER_AGENT = "CarClubFuture data foundation (https://carclubfuture.com)";

// 1 request per 3 000 ms
const limiter = new RateLimiter(1 / 3);  // 0.333 rps → intervalMs = 3000ms

// ── Helpers ───────────────────────────────────────────────────────────────────
function yyyymm(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function fetchAndParseBatPage(vehicle) {
  const { year, make, model } = vehicle;
  const url = batSearchUrl({ year, make, model });

  await limiter.take();

  const resp = await fetchWithRetry(url, {
    headers: { "User-Agent": BAT_USER_AGENT },
  });

  if (!resp.ok) {
    const err = new Error(`BaT HTTP ${resp.status} for ${url}`);
    err.status = resp.status;
    throw err;
  }

  const html = await resp.text();
  return parseBatResultsHtml(html);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  const vehicles = catalog.vehicles;
  const month = yyyymm();

  // Load existing history (if any) so we can merge without losing older months.
  const existingHistory = existsSync(OUTPUT_PATH)
    ? JSON.parse(readFileSync(OUTPUT_PATH, "utf8"))
    : {};

  const history = { ...existingHistory };
  let ok = 0;
  let failed = 0;

  for (const vehicle of vehicles) {
    const { slug, year, make, model } = vehicle;
    const pk = `bat-history#${slug}#${month}`;
    const start = Date.now();

    let results;
    let cache_layer;

    try {
      const cached = await withCache({
        pk,
        sk: "v1",
        ttlSeconds: TTL_SECONDS,
        source: "bat",
        fetchOrigin: () => fetchAndParseBatPage({ year, make, model }),
        bundledFallback: () => null,
      });
      results     = cached.value ?? [];
      cache_layer = cached.layer;
    } catch (err) {
      jsonLog({
        operation: "bat.sync.error",
        slug,
        error: err,
        status: err.status ?? null,
      });
      failed++;
      continue;
    }

    history[slug] = {
      lastSyncedAt: new Date().toISOString(),
      results: results ?? [],
    };

    jsonLog({
      operation: "bat.sync",
      slug,
      cache_layer,
      results_count: (results ?? []).length,
      durationMs: Date.now() - start,
    });
    ok++;
  }

  await writeJsonAtomic(OUTPUT_PATH, history);

  jsonLog({
    operation: "bat.sync.complete",
    ok,
    failed,
    outputPath: OUTPUT_PATH,
  });
}

await timed("bat.sync.main", async () => {
  await main();
  return { recordsProcessed: 0, ok: 0, failed: 0 };
});
