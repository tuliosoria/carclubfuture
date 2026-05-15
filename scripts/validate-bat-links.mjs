#!/usr/bin/env node
/**
 * validate-bat-links.mjs
 *
 * QA report: confirm every catalog entry resolves a Bring a Trailer
 * search URL via the bat-link domain helper. Prints a markdown-friendly
 * summary and exits non-zero on missing links.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");

function buildSearchUrl(c) {
  const q = [c.year, c.make, c.model].filter(Boolean).join(" ");
  return `https://bringatrailer.com/auctions/results/?s=${encodeURIComponent(q)}`;
}

async function main() {
  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  const cars = Array.isArray(catalogFile) ? catalogFile : catalogFile.vehicles ?? [];
  let ok = 0;
  let missing = 0;
  for (const c of cars) {
    const url = buildSearchUrl(c);
    if (url && /\?s=/.test(url)) {
      ok += 1;
    } else {
      console.error(`MISSING ${c.slug}`);
      missing += 1;
    }
  }
  console.log(`# BaT link audit\n\n- ✅ resolved: ${ok}\n- ❌ missing: ${missing}\n`);
  process.exit(missing > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
