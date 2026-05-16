#!/usr/bin/env node
/**
 * build-limitations-report.mjs — aggregate data gaps and pipeline state into
 * a single limitations report.
 *
 * Usage:
 *   node scripts/build-limitations-report.mjs
 *
 * Reads (all optional — missing files get empty defaults):
 *   src/lib/data/cars-ml/cars-catalog.json
 *   src/lib/data/cars-ml/price-aggregates.json
 *   src/lib/data/cars-ml/community-score.json
 *   src/lib/data/cars-ml/missing-images.json
 *   src/lib/data/cars-ml/macro-features.json
 *   src/lib/data/cars-ml/training-summary.json
 *
 * Writes: scripts/output/limitations-report.json
 * Prints: JSON to stdout
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { writeJsonAtomic, jsonLog } from "./_lib/http.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// ── Pure aggregation function (exported for tests) ───────────────────────────

/**
 * @typedef {{
 *   catalog: { vehicles: Array<{ slug: string }> },
 *   priceAggregates: Record<string, { auction_count_36mo?: number }>,
 *   communityScores: Record<string, { data_points?: number }>,
 *   missingImages: { slugs?: string[] },
 *   macroFeatures: { correlated_sp500_12mo?: unknown, correlated_gold_12mo?: unknown, data_status?: string },
 *   trainingSummary: { status?: string, horizons?: Record<string, { trained: boolean, reason?: string }> },
 *   apiCallStats: Array<{ source: string, status_code: number, slug?: string, occurred_at: string }>,
 * }} ReportInputs
 */

/**
 * Build a limitations report from pre-loaded data.
 *
 * @param {ReportInputs} opts
 * @returns {object} Limitations report object
 */
export function buildLimitationsReport({
  catalog = { vehicles: [] },
  priceAggregates = {},
  communityScores = {},
  missingImages = {},
  macroFeatures = {},
  trainingSummary = {},
  apiCallStats = [],
} = {}) {
  const vehicles = catalog.vehicles ?? [];
  const slugs = vehicles.map((v) => v.slug ?? v.id).filter(Boolean);

  // ── Forecast eligibility (auction_count_36mo >= 5) ───────────────────────
  const forecastEligible = [];
  const notForecastEligible = [];
  for (const slug of slugs) {
    const agg = priceAggregates[slug];
    if (agg && (agg.auction_count_36mo ?? 0) >= 5) {
      forecastEligible.push(slug);
    } else {
      notForecastEligible.push(slug);
    }
  }

  // ── Community low confidence (< 10 data points) ──────────────────────────
  const communityLowConfidence = slugs.filter((slug) => {
    const cs = communityScores[slug];
    return !cs || (cs.data_points ?? 0) < 10;
  });

  // ── Image missing ─────────────────────────────────────────────────────────
  const imageMissing = missingImages.slugs ?? [];

  // ── Macro data status ─────────────────────────────────────────────────────
  const sp500Status =
    macroFeatures.correlated_sp500_12mo != null ? "ok" : "insufficient";
  const goldStatus =
    macroFeatures.correlated_gold_12mo != null ? "ok" : "insufficient";

  // ── ML training status ───────────────────────────────────────────────────
  const horizons = trainingSummary.horizons ?? {};
  const trainedHorizons = Object.entries(horizons)
    .filter(([, v]) => v.trained)
    .map(([k]) => k);
  const untrainedHorizons = Object.entries(horizons)
    .filter(([, v]) => !v.trained)
    .map(([k, v]) => ({ horizon: k, reason: v.reason ?? "unknown" }));

  return {
    generated_at: new Date().toISOString(),
    vehicles: {
      total_catalog: slugs.length,
      forecast_eligible: forecastEligible.length,
      not_forecast_eligible: notForecastEligible,
      image_missing: imageMissing,
      community_low_confidence: communityLowConfidence,
    },
    data_sources: {
      macro: {
        sp500_status: sp500Status,
        gold_status: goldStatus,
      },
      oldcarsdata: {
        calls_this_run: null,
        free_tier_remaining: null,
      },
      bat: {
        scrape_enabled: process.env.BAT_SCRAPE_ENABLED === "1",
        slugs_scraped: Object.keys(priceAggregates).filter(
          (slug) => priceAggregates[slug]?.bat_count_36mo > 0
        ).length,
      },
    },
    ml: {
      status: trainingSummary.status ?? "unknown",
      trained_horizons: trainedHorizons,
      untrained_horizons: untrainedHorizons,
    },
    api_errors: apiCallStats,
    open_questions: [
      "OldCarsData free tier returns last 14 days only — paid tier needed for 12mo/36mo aggregates",
      "Stooq CSV endpoint now requires captcha — alternative macro source needed (FRED, Yahoo, Twelve Data)",
      "Need 30+ vehicles with auction_count_36mo >= 5 before XGBoost training is meaningful",
      "Wikimedia attribution must render in CarForecastCard component (legal requirement)",
    ],
  };
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

function safeReadJson(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const dataDir = join(REPO_ROOT, "src/lib/data/cars-ml");
  const outputDir = join(__dirname, "output");

  const catalog = safeReadJson(join(dataDir, "cars-catalog.json"), { vehicles: [] });
  const priceAggregates = safeReadJson(join(dataDir, "price-aggregates.json"), {});
  const communityScores = safeReadJson(join(dataDir, "community-score.json"), {});
  const missingImages = safeReadJson(join(dataDir, "missing-images.json"), { slugs: [] });
  const macroFeatures = safeReadJson(join(dataDir, "macro-features.json"), {});
  const trainingSummary = safeReadJson(join(dataDir, "training-summary.json"), {});

  const report = buildLimitationsReport({
    catalog,
    priceAggregates,
    communityScores,
    missingImages,
    macroFeatures,
    trainingSummary,
    apiCallStats: [],
  });

  const outPath = join(outputDir, "limitations-report.json");
  await writeJsonAtomic(outPath, report);

  jsonLog({ operation: "build.limitations.done", outPath });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
