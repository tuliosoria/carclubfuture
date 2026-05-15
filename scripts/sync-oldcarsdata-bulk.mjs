#!/usr/bin/env node
/**
 * sync-oldcarsdata-bulk.mjs
 *
 * Bulk-import an OldCarsData CSV export of historical auction results.
 * Writes per-slug appended history to dual-channel-monthly-snapshots.json.
 *
 * Usage: node scripts/sync-oldcarsdata-bulk.mjs path/to/export.csv
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "src/lib/data/cars-ml/dual-channel-monthly-snapshots.json");
const log = (msg) => console.error(`[sync:oldcarsdata:bulk] ${msg}`);

function parseCsv(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  const cols = header.split(",").map((c) => c.trim());
  return rows.map((r) => {
    const cells = r.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]?.trim() ?? ""]));
  });
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    log("usage: sync-oldcarsdata-bulk.mjs <csv>");
    process.exit(1);
  }
  const text = await readFile(csvPath, "utf8");
  const rows = parseCsv(text);
  log(`parsed ${rows.length} rows`);

  const bySlug = new Map();
  for (const row of rows) {
    const slug = row.slug;
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push({
      month: row.month,
      channel: row.channel,
      median_sold_usd: Number(row.median_sold_usd) || null,
      sold_count: Number(row.sold_count) || 0,
      reserve_met_rate: Number(row.reserve_met_rate) || null,
    });
  }

  const out = Object.fromEntries(bySlug);
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
  log(`wrote ${bySlug.size} slugs, ${rows.length} snapshots`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
