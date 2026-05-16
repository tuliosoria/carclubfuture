/**
 * Promote bulk → primary catalog.
 *
 * Reads the hand-curated seed cars-catalog.json (CollectorCar shape, 12
 * vehicles with rich segment/rarity/description metadata) and the
 * NHTSA-sourced cars-catalog-bulk.json (BulkCatalogRow shape, ~tens of
 * thousands of rows). Merges them into a single primary catalog:
 *
 *   - Keep the existing { version, generatedAt, vehicles } envelope.
 *   - Convert each bulk row to a CollectorCar-like shape using NHTSA
 *     data + null/sensible defaults for what NHTSA doesn't provide
 *     (honesty rule).
 *   - Dedupe by slug. When a slug exists in BOTH, the seed wins —
 *     bulk only fills GAPS (never overwrites a richer hand-curated field).
 *
 * CLI:
 *   node scripts/promote-bulk-to-catalog.mjs \
 *     --seed=src/lib/data/cars-ml/cars-catalog.json \
 *     --bulk=src/lib/data/cars-ml/cars-catalog-bulk.json \
 *     --output=src/lib/data/cars-ml/cars-catalog.json
 */

import { readFile } from "node:fs/promises";
import { writeJsonAtomic, jsonLog } from "./_lib/http.mjs";

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Title-case a SHOUTY NHTSA make/model name. */
function titleCase(s) {
  if (!s) return s;
  return s
    .toLowerCase()
    .split(/(\s|-|\/)/)
    .map((tok) => (/^[a-z]/.test(tok) ? tok[0].toUpperCase() + tok.slice(1) : tok))
    .join("");
}

/**
 * Convert a BulkCatalogRow → a CollectorCar-shaped object. NHTSA does
 * not give us segment/rarity/bodyStyle/description, so those default
 * to null (or "modern-collectible" for segment as a placeholder is
 * dishonest — leave it null and let downstream filters handle).
 */
function bulkToCollectorCar(row) {
  const make = titleCase(row.makeDisplay || row.make);
  const model = row.model;
  const displayName = `${row.year} ${make} ${model}`;
  return {
    id: row.slug,
    slug: row.slug,
    carqueryId: row.carqueryId ?? null,
    nhtsaId: row.nhtsaId ?? null,
    year: row.year,
    make,
    model,
    trim: row.trim ?? null,
    displayName,
    segment: null,
    era: row.era ?? null,
    bodyStyle: row.bodyStyle ?? null,
    market: null,
    rarity: null,
    productionTotal: null,
    engineDisplacementCc: row.engineDisplacementCc ?? null,
    cylinders: row.cylinders ?? null,
    isConvertible: row.isConvertible ?? null,
    description: null,
    catalogConfidence: row.catalogConfidence ?? "low",
    source: row.source ?? "nhtsa",
  };
}

/**
 * Merge an existing seed vehicle with a bulk vehicle of the same slug.
 * Seed wins for any field where seed has a non-null/non-undefined value;
 * bulk only fills gaps. Bulk-only metadata fields (nhtsaId, catalogConfidence)
 * are always copied in if missing from seed.
 */
function mergeFillGaps(seed, bulk) {
  const out = { ...bulk, ...seed }; // seed last so it wins for shared keys
  // Explicit gap-fill: where seed has null/undefined, take from bulk.
  for (const key of Object.keys(bulk)) {
    if (out[key] == null && bulk[key] != null) {
      out[key] = bulk[key];
    }
  }
  // Always carry NHTSA cross-reference if seed didn't have one.
  if (!seed.nhtsaId && bulk.nhtsaId) out.nhtsaId = bulk.nhtsaId;
  return out;
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? true];
    })
  );

  const seedPath = args.seed ?? "src/lib/data/cars-ml/cars-catalog.json";
  const bulkPath = args.bulk ?? "src/lib/data/cars-ml/cars-catalog-bulk.json";
  const outputPath = args.output ?? seedPath;

  const start = Date.now();

  const seedRaw = JSON.parse(await readFile(seedPath, "utf8"));
  const seedVehicles = Array.isArray(seedRaw)
    ? seedRaw
    : Array.isArray(seedRaw.vehicles)
      ? seedRaw.vehicles
      : [];
  const envelope = Array.isArray(seedRaw)
    ? null
    : { version: seedRaw.version, generatedAt: seedRaw.generatedAt };

  // Re-key seed by slug, normalising slug if missing.
  const bySlug = new Map();
  for (const v of seedVehicles) {
    const slug = v.slug || slugify(`${v.year}-${v.make}-${v.model}`);
    bySlug.set(slug, { ...v, slug });
  }
  const seedCount = bySlug.size;

  const bulkRaw = JSON.parse(await readFile(bulkPath, "utf8"));
  const bulkRows = Array.isArray(bulkRaw) ? bulkRaw : [];

  let mergedCount = 0;
  let addedCount = 0;
  for (const row of bulkRows) {
    const cc = bulkToCollectorCar(row);
    if (bySlug.has(cc.slug)) {
      bySlug.set(cc.slug, mergeFillGaps(bySlug.get(cc.slug), cc));
      mergedCount++;
    } else {
      bySlug.set(cc.slug, cc);
      addedCount++;
    }
  }

  const merged = [...bySlug.values()].sort((a, b) =>
    a.slug.localeCompare(b.slug)
  );

  const output = envelope
    ? {
        version: envelope.version ?? "1.0.0",
        generatedAt: new Date().toISOString(),
        vehicles: merged,
      }
    : merged;

  await writeJsonAtomic(outputPath, output);

  jsonLog({
    operation: "promote.bulk-to-catalog",
    durationMs: Date.now() - start,
    seedCount,
    bulkCount: bulkRows.length,
    mergedOverlaps: mergedCount,
    addedFromBulk: addedCount,
    finalCount: merged.length,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
