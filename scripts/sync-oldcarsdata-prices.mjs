#!/usr/bin/env node
/**
 * sync-oldcarsdata-prices.mjs
 *
 * Pulls live OldCarsData auction results for every catalog vehicle.
 * Writes oldcarsdata-current-prices.json and (optionally) DynamoDB
 * cache entries under prefix `oldcarsdata#<slug>`.
 *
 * Requires OLDCARSDATA_API_KEY. No-ops with exit 0 if missing.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const OUT = resolve(ROOT, "src/lib/data/cars-ml/oldcarsdata-current-prices.json");
const ENDPOINT = process.env.OLDCARSDATA_BASE_URL ?? "https://api.oldcarsdata.com/v1";

const log = (msg, extra = "") => console.error(`[sync:oldcarsdata] ${msg}${extra ? " " + extra : ""}`);

async function fetchSnapshot(apiKey, slug, year, make, model) {
  const url = `${ENDPOINT}/vehicles/snapshot?year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "CarClubFuture/1.0",
    },
  });
  if (!resp.ok) {
    log(`snapshot ${slug} failed: ${resp.status}`);
    return null;
  }
  return resp.json();
}

async function main() {
  const apiKey = process.env.OLDCARSDATA_API_KEY;
  if (!apiKey) {
    log("OLDCARSDATA_API_KEY missing; skipping live sync (catalog still bundled)");
    return;
  }

  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  const cars = Array.isArray(catalogFile) ? catalogFile : catalogFile.vehicles ?? [];
  /** @type {Record<string, unknown>} */
  const out = {};

  let ok = 0;
  let failed = 0;
  for (const c of cars) {
    try {
      const snap = await fetchSnapshot(apiKey, c.slug, c.year, c.make, c.model);
      if (snap) {
        out[c.slug] = snap;
        ok += 1;
      } else {
        failed += 1;
      }
      // ~1 req/s — be polite
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      failed += 1;
      log(`error ${c.slug}: ${String(err)}`);
    }
  }

  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
  log(`done: ${ok} ok, ${failed} failed, wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
