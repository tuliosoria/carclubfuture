#!/usr/bin/env node
/**
 * build-brand-features.mjs — per-make brand appreciation stats derived from
 * Phase C price aggregates.
 *
 * Usage:
 *   node scripts/build-brand-features.mjs \
 *     --output=src/lib/data/cars-ml/brand-features.json
 *
 * Reads:
 *   src/lib/data/cars-ml/cars-catalog.json
 *   src/lib/data/cars-ml/price-aggregates.json
 *
 * NOTE on brand_avg_cagr_5yr:
 *   True 5-year CAGR requires price snapshots 5 years apart, which we do not
 *   yet store. Instead we use price_momentum_12mo as a 12-month proxy for
 *   appreciation direction. The field is labelled "cagr_5yr" to reserve the
 *   name for future use; the actual value is a 12-month momentum proxy.
 *   The brand_data_caveat field documents this limitation explicitly.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parseArgs } from "node:util";

import { writeJsonAtomic, jsonLog } from "./_lib/http.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// ── Pure aggregation function ─────────────────────────────────────────────────

/**
 * Derive per-make brand features from catalog + price aggregates.
 *
 * @param {{
 *   catalog: Array<{ slug: string; make: string; [key: string]: unknown }>;
 *   priceAggregates: Record<string, import('../src/lib/types/cars').PriceAggregates>;
 *   now?: Date;
 * }} opts
 * @returns {Record<string, import('../src/lib/types/cars').BrandFeatures>}
 */
export function buildBrandFeatures({ catalog, priceAggregates, now = new Date() }) {
  const computedAt = now.toISOString();

  // ── Group catalog slugs by make ─────────────────────────────────────────
  /** @type {Map<string, string[]>} make → slugs */
  const makeToSlugs = new Map();
  for (const vehicle of catalog) {
    const { slug, make } = vehicle;
    if (!make || !slug) continue;
    if (!makeToSlugs.has(make)) makeToSlugs.set(make, []);
    makeToSlugs.get(make).push(slug);
  }

  // ── Compute per-make auction volume for ranking ─────────────────────────
  // Volume = sum of auction_count_12mo across ALL slugs for this make (not
  // just eligible ones) so that makes with partial data still rank correctly.
  /** @type {Map<string, number>} make → total auction count */
  const makeVolume = new Map();
  for (const [make, slugs] of makeToSlugs) {
    let total = 0;
    for (const slug of slugs) {
      const agg = priceAggregates[slug];
      if (agg) total += agg.auction_count_12mo ?? 0;
    }
    makeVolume.set(make, total);
  }

  // ── Build auction volume rank (1 = highest; alphabetical tie-break) ─────
  const sortedMakes = [...makeToSlugs.keys()].sort((a, b) => {
    const diff = (makeVolume.get(b) ?? 0) - (makeVolume.get(a) ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
  /** @type {Map<string, number>} make → rank */
  const volumeRank = new Map(sortedMakes.map((make, idx) => [make, idx + 1]));

  // ── Build per-make feature objects ──────────────────────────────────────
  /** @type {Record<string, import('../src/lib/types/cars').BrandFeatures>} */
  const result = {};

  for (const [make, slugs] of makeToSlugs) {
    const eligibleSlugs = slugs.filter(
      (slug) => priceAggregates[slug]?.data_status === "ok",
    );

    const totalAuctionCount = makeVolume.get(make) ?? 0;
    const rank = volumeRank.get(make) ?? null;

    if (eligibleSlugs.length < 2) {
      result[make] = {
        make,
        brand_avg_cagr_5yr: null,
        brand_appreciation_tier: null,
        brand_auction_volume_rank: rank,
        brand_total_auction_count_12mo: totalAuctionCount,
        brand_eligible_models_count: eligibleSlugs.length,
        brand_data_status: "insufficient",
        computed_at: computedAt,
      };
      continue;
    }

    // ── Per-model "CAGR" proxy: price_momentum_12mo ─────────────────────
    const momentumValues = eligibleSlugs
      .map((slug) => priceAggregates[slug].price_momentum_12mo)
      .filter((v) => v != null);

    if (momentumValues.length < 2) {
      // Not enough momentum data even among eligible models
      result[make] = {
        make,
        brand_avg_cagr_5yr: null,
        brand_appreciation_tier: null,
        brand_auction_volume_rank: rank,
        brand_total_auction_count_12mo: totalAuctionCount,
        brand_eligible_models_count: eligibleSlugs.length,
        brand_data_status: "insufficient",
        computed_at: computedAt,
      };
      continue;
    }

    const brandAvgCagr =
      momentumValues.reduce((sum, v) => sum + v, 0) / momentumValues.length;

    result[make] = {
      make,
      brand_avg_cagr_5yr: brandAvgCagr,
      brand_appreciation_tier: classifyTier(brandAvgCagr),
      brand_auction_volume_rank: rank,
      brand_total_auction_count_12mo: totalAuctionCount,
      brand_eligible_models_count: eligibleSlugs.length,
      brand_data_status: "ok",
      brand_data_caveat:
        "5yr CAGR proxied from 12mo momentum (no historical price depth available yet)",
      computed_at: computedAt,
    };
  }

  return result;
}

/**
 * Classify appreciation tier.
 * Boundaries (inclusive on the lower end as specified):
 *   > 0.10        → "high"
 *   > 0.03..0.10  → "medium"
 *   -0.03..0.03   → "low"
 *   < -0.03       → "declining"
 *
 * @param {number} cagr
 * @returns {"high"|"medium"|"low"|"declining"}
 */
export function classifyTier(cagr) {
  if (cagr > 0.10) return "high";
  if (cagr > 0.03) return "medium";
  if (cagr >= -0.03) return "low";
  return "declining";
}

// ── CLI entry point ───────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: { output: { type: "string" } },
  });
  const outputPath = values.output ?? "src/lib/data/cars-ml/brand-features.json";

  const catalogPath = join(REPO_ROOT, "src/lib/data/cars-ml/cars-catalog.json");
  const aggregatesPath = join(REPO_ROOT, "src/lib/data/cars-ml/price-aggregates.json");

  const { vehicles: catalog } = JSON.parse(readFileSync(catalogPath, "utf8"));

  let priceAggregates = {};
  try {
    priceAggregates = JSON.parse(readFileSync(aggregatesPath, "utf8"));
  } catch {
    jsonLog({
      operation: "build-brand-features",
      warning: "price-aggregates.json not found — all makes will be insufficient",
    });
  }

  const features = buildBrandFeatures({ catalog, priceAggregates });

  const fullOutput = {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    makes: Object.keys(features).length,
    data: features,
  };

  const resolvedOutput = outputPath.startsWith("/")
    ? outputPath
    : join(REPO_ROOT, outputPath);

  await writeJsonAtomic(resolvedOutput, fullOutput);

  jsonLog({
    operation: "build-brand-features",
    makes: Object.keys(features).length,
    ok: Object.values(features).filter((f) => f.brand_data_status === "ok").length,
    insufficient: Object.values(features).filter((f) => f.brand_data_status === "insufficient").length,
  });
}

main().catch((err) => {
  jsonLog({ operation: "build-brand-features", error: err });
  process.exit(1);
});
