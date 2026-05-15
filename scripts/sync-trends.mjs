#!/usr/bin/env node
/**
 * sync-trends.mjs
 *
 * Captures a Google Trends snapshot for every catalog make/model.
 * Writes incrementally to community-score.json. Throttled to 1 req/s.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const OUT = resolve(ROOT, "src/lib/data/cars-ml/community-score.json");

const log = (msg) => console.error(`[sync:trends] ${msg}`);

async function main() {
  let trends;
  try {
    trends = (await import("google-trends-api")).default;
  } catch (err) {
    log(`google-trends-api unavailable (${String(err)}); skipping`);
    return;
  }
  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  const cars = Array.isArray(catalogFile) ? catalogFile : catalogFile.vehicles ?? [];
  const existing = await readFile(OUT, "utf8").then(JSON.parse).catch(() => ({}));

  for (const c of cars) {
    const key = `${c.make}-${c.model}`.toLowerCase();
    try {
      const raw = await trends.interestOverTime({
        keyword: `${c.year} ${c.make} ${c.model}`,
        startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        geo: "US",
      });
      const json = JSON.parse(raw);
      const points = json?.default?.timelineData ?? [];
      const last = points.at(-1)?.value?.[0] ?? null;
      const avg = points.length
        ? Math.round(points.reduce((s, p) => s + (p.value?.[0] ?? 0), 0) / points.length)
        : null;
      existing[key] = {
        slug: c.slug,
        last,
        avg12mo: avg,
        captured: new Date().toISOString(),
      };
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      log(`trends fetch ${key} failed: ${String(err)}`);
    }
  }

  await writeFile(OUT, JSON.stringify(existing, null, 2) + "\n");
  log(`wrote ${Object.keys(existing).length} entries`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
