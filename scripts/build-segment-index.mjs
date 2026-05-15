#!/usr/bin/env node
/**
 * build-segment-index.mjs
 *
 * Quarterly segment-index snapshots: average Condition #2 value across
 * each segment's component vehicles, normalized to a base of 100.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const PRICES = resolve(ROOT, "src/lib/data/cars-ml/oldcarsdata-current-prices.json");
const MULTS = resolve(ROOT, "src/lib/data/cars-ml/condition-multipliers.json");
const EXISTING = resolve(ROOT, "src/lib/data/cars-ml/segment-index.json");

const log = (msg) => console.error(`[segment:index] ${msg}`);

function quarterOf(date = new Date()) {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

async function main() {
  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  const cars = Array.isArray(catalogFile) ? catalogFile : catalogFile.vehicles ?? [];
  const prices = await readFile(PRICES, "utf8").then(JSON.parse).catch(() => ({}));
  const mults = JSON.parse(await readFile(MULTS, "utf8"));
  const existing = await readFile(EXISTING, "utf8").then(JSON.parse).catch(() => ({ segments: [] }));

  const bySegment = new Map();
  for (const c of cars) {
    if (!c.segment) continue;
    const snap = prices[c.slug] ?? c.price;
    const v = snap?.valueUsd ?? snap?.value_usd;
    if (!v) continue;
    const segMult = mults.bySegment?.[c.segment]?.["2"] ?? mults.default?.["2"] ?? 1.2;
    const c2 = v * segMult;
    if (!bySegment.has(c.segment)) bySegment.set(c.segment, []);
    bySegment.get(c.segment).push(c2);
  }

  const quarter = quarterOf();
  const segments = [...bySegment.entries()].map(([segment, vals]) => {
    const avg = vals.reduce((s, n) => s + n, 0) / vals.length;
    const prev = existing.segments?.find((s) => s.segment === segment);
    const prevHistory = prev?.history ?? [];
    const indexValue = Number((avg / 1000).toFixed(1));
    const last = prevHistory.at(-1);
    const change = last && last.indexValue ? indexValue / last.indexValue - 1 : 0;
    const history = [...prevHistory.filter((p) => p.quarter !== quarter), { quarter, indexValue, componentCount: vals.length }];
    return {
      segment,
      current: indexValue,
      quarterlyChangePct: Number(change.toFixed(4)),
      componentCount: vals.length,
      history,
    };
  });

  const out = { asOf: new Date().toISOString().slice(0, 10), segments };
  await writeFile(EXISTING, JSON.stringify(out, null, 2) + "\n");
  log(`wrote ${segments.length} segment indexes for ${quarter}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
