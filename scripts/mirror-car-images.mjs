#!/usr/bin/env node
/**
 * mirror-car-images.mjs
 *
 * Mirrors OldCarsData / Wikimedia vehicle photos into public/cars/.
 * Skips entries that already have a local image.
 */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const OUT_DIR = resolve(ROOT, "public/cars");

const log = (msg) => console.error(`[mirror:images] ${msg}`);

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  const cars = Array.isArray(catalogFile) ? catalogFile : catalogFile.vehicles ?? [];

  let mirrored = 0;
  let skipped = 0;
  for (const c of cars) {
    const url = c.imageUrl;
    if (!url || !/^https?:/i.test(url)) {
      skipped += 1;
      continue;
    }
    const ext = extname(new URL(url).pathname) || ".jpg";
    const dest = resolve(OUT_DIR, `${c.slug}${ext}`);
    if (await exists(dest)) {
      skipped += 1;
      continue;
    }
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`status ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      await writeFile(dest, buf);
      mirrored += 1;
    } catch (err) {
      log(`mirror ${c.slug} failed: ${String(err)}`);
    }
  }

  log(`mirrored ${mirrored}, skipped ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
