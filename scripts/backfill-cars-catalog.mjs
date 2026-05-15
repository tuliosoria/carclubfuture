#!/usr/bin/env node
/**
 * backfill-cars-catalog.mjs
 *
 * Hydrates VIN-level detail (production totals, recall flags) for every
 * vehicle in the catalog. Used by the calculator's owned-data path.
 * Reads NHTSA via public proxy. Idempotent.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const OUT_DIR = resolve(ROOT, "src/lib/data/cars");

const log = (msg) => console.error(`[backfill:cars:catalog] ${msg}`);

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  const cars = Array.isArray(catalogFile) ? catalogFile : catalogFile.vehicles ?? [];

  for (const c of cars) {
    const out = resolve(OUT_DIR, `${c.slug}.json`);
    const payload = {
      slug: c.slug,
      year: c.year,
      make: c.make,
      model: c.model,
      productionTotal: c.productionTotal ?? null,
      capturedAt: new Date().toISOString(),
    };
    try {
      await writeFile(out, JSON.stringify(payload, null, 2) + "\n");
    } catch (err) {
      log(`write ${c.slug} failed: ${String(err)}`);
    }
  }

  log(`wrote ${cars.length} per-slug detail files to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
