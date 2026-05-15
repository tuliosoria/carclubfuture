#!/usr/bin/env node
/**
 * build-segment-catalog.mjs
 *
 * Re-derives segment groupings (Blue Chip, American Muscle, etc.) from
 * the catalog and writes segment-catalog.json. Idempotent.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const OUT = resolve(ROOT, "src/lib/data/cars-ml/segment-catalog.json");

const log = (msg) => console.error(`[sync:cars:segments] ${msg}`);

async function main() {
  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  const cars = Array.isArray(catalogFile) ? catalogFile : catalogFile.vehicles ?? [];
  const bySegment = new Map();
  for (const c of cars) {
    if (!c.segment) continue;
    if (!bySegment.has(c.segment)) bySegment.set(c.segment, []);
    bySegment.get(c.segment).push({ slug: c.slug, displayName: c.displayName });
  }
  const out = [...bySegment.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([segment, members]) => ({ segment, count: members.length, members }));
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
  log(`wrote ${out.length} segment groups (${cars.length} vehicles total)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
