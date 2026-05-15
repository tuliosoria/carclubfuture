#!/usr/bin/env node
/**
 * build-community-score.mjs
 *
 * Composite community signal: Reddit mention count + Google Trends avg.
 * Writes a normalized 0..1 score per slug. Inputs are best-effort —
 * missing inputs collapse the score to a neutral 0.5.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const TRENDS = resolve(ROOT, "src/lib/data/cars-ml/community-score.json");
const OUT = TRENDS;

const log = (msg) => console.error(`[community:score] ${msg}`);

async function main() {
  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  const cars = Array.isArray(catalogFile) ? catalogFile : catalogFile.vehicles ?? [];
  const trends = await readFile(TRENDS, "utf8").then(JSON.parse).catch(() => ({}));

  const out = {};
  for (const c of cars) {
    const key = `${c.make}-${c.model}`.toLowerCase();
    const t = trends[key] ?? {};
    const trendScore = typeof t.avg12mo === "number" ? Math.min(t.avg12mo / 100, 1) : 0.5;
    const reddit = typeof t.redditMentions === "number" ? Math.min(t.redditMentions / 200, 1) : 0.5;
    const community = Number(((trendScore * 0.6 + reddit * 0.4) * 100).toFixed(1));
    out[c.slug] = {
      slug: c.slug,
      score: community,
      trendScore: Number((trendScore * 100).toFixed(1)),
      redditScore: Number((reddit * 100).toFixed(1)),
      asOf: new Date().toISOString().slice(0, 10),
    };
  }

  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
  log(`wrote ${cars.length} community scores`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
