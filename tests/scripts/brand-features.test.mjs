/**
 * Unit tests for scripts/build-brand-features.mjs
 *
 * Tests the pure `buildBrandFeatures` and `classifyTier` functions — no fs,
 * no network.
 *
 * Test cases:
 *   1. Two makes, both with sufficient data — correct CAGR, tier, rank
 *   2. One make with only 1 eligible model — brand_data_status "insufficient"
 *   3. Tier boundary values land in the right buckets
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildBrandFeatures, classifyTier } from "../../scripts/build-brand-features.mjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgg(overrides = {}) {
  return {
    data_status: "ok",
    price_momentum_12mo: 0.05,
    auction_count_12mo: 10,
    auction_median_12mo: 50000,
    current_price_c3: 50000,
    ...overrides,
  };
}

// ── Test 1: Two makes, both with sufficient data ──────────────────────────────

test("two makes with sufficient data: correct CAGR, tier, and volume rank", () => {
  const now = new Date("2024-07-01T00:00:00Z");

  const catalog = [
    { slug: "1969-chevrolet-camaro", make: "Chevrolet" },
    { slug: "1970-chevrolet-nova",   make: "Chevrolet" },
    { slug: "1970-ford-mustang",     make: "Ford" },
    { slug: "1967-ford-shelby",      make: "Ford" },
  ];

  const priceAggregates = {
    "1969-chevrolet-camaro": makeAgg({ price_momentum_12mo: 0.08, auction_count_12mo: 20 }),
    "1970-chevrolet-nova":   makeAgg({ price_momentum_12mo: 0.12, auction_count_12mo: 15 }),
    "1970-ford-mustang":     makeAgg({ price_momentum_12mo: 0.02, auction_count_12mo: 5 }),
    "1967-ford-shelby":      makeAgg({ price_momentum_12mo: 0.04, auction_count_12mo: 8 }),
  };

  const features = buildBrandFeatures({ catalog, priceAggregates, now });

  // Chevrolet: mean of [0.08, 0.12] = 0.10 → tier boundary: 0.10 is NOT > 0.10, so "medium"
  const chev = features["Chevrolet"];
  assert.ok(chev, "Chevrolet features should exist");
  assert.equal(chev.brand_data_status, "ok");
  assert.equal(chev.brand_eligible_models_count, 2);
  assert.ok(Math.abs(chev.brand_avg_cagr_5yr - 0.10) < 1e-9, "Chevrolet CAGR ~0.10");
  assert.equal(chev.brand_appreciation_tier, "medium", "0.10 not > 0.10 → medium");

  // Ford: mean of [0.02, 0.04] = 0.03 → tier: 0.03 is >= -0.03 and not > 0.03 → "low"
  const ford = features["Ford"];
  assert.ok(ford, "Ford features should exist");
  assert.equal(ford.brand_data_status, "ok");
  assert.ok(Math.abs(ford.brand_avg_cagr_5yr - 0.03) < 1e-9, "Ford CAGR ~0.03");
  assert.equal(ford.brand_appreciation_tier, "low", "0.03 → low");

  // Volume rank: Chevrolet total=35, Ford total=13 → Chevrolet rank 1
  assert.equal(chev.brand_auction_volume_rank, 1, "Chevrolet highest volume → rank 1");
  assert.equal(ford.brand_auction_volume_rank, 2, "Ford → rank 2");

  // computed_at matches now
  assert.equal(chev.computed_at, now.toISOString());
});

// ── Test 2: Make with only 1 eligible model → insufficient ───────────────────

test("make with only 1 eligible model → brand_data_status 'insufficient', numerics null", () => {
  const now = new Date("2024-07-01T00:00:00Z");

  const catalog = [
    { slug: "1970-plymouth-cuda",    make: "Plymouth" },
    { slug: "1971-plymouth-satellite", make: "Plymouth" },
  ];

  const priceAggregates = {
    // Only one has data_status "ok"
    "1970-plymouth-cuda":      makeAgg({ data_status: "ok", auction_count_12mo: 5 }),
    "1971-plymouth-satellite": makeAgg({ data_status: "insufficient", auction_count_12mo: 1 }),
  };

  const features = buildBrandFeatures({ catalog, priceAggregates, now });

  const plym = features["Plymouth"];
  assert.ok(plym, "Plymouth features should exist");
  assert.equal(plym.brand_data_status, "insufficient");
  assert.equal(plym.brand_avg_cagr_5yr, null);
  assert.equal(plym.brand_appreciation_tier, null);
  assert.equal(plym.brand_eligible_models_count, 1);
  // Volume rank is still set (uses all slugs regardless of eligibility)
  assert.ok(plym.brand_auction_volume_rank != null, "rank set even for insufficient makes");
  // Total auction count includes both slugs
  assert.equal(plym.brand_total_auction_count_12mo, 6);
});

// ── Test 3: Tier boundary values ──────────────────────────────────────────────

test("classifyTier boundary values land in correct buckets", () => {
  // Strictly above 0.10 → "high"
  assert.equal(classifyTier(0.101), "high");
  assert.equal(classifyTier(0.5),   "high");

  // Exactly 0.10: NOT > 0.10 → "medium"
  assert.equal(classifyTier(0.10),  "medium");

  // Strictly above 0.03 and ≤ 0.10 → "medium"
  assert.equal(classifyTier(0.031), "medium");
  assert.equal(classifyTier(0.099), "medium");

  // Exactly 0.03: NOT > 0.03 → "low"
  assert.equal(classifyTier(0.03),  "low");

  // Between -0.03 and 0.03 inclusive → "low"
  assert.equal(classifyTier(0.00),  "low");
  assert.equal(classifyTier(-0.029), "low");

  // Exactly -0.03 → "low"
  assert.equal(classifyTier(-0.03), "low");

  // Strictly below -0.03 → "declining"
  assert.equal(classifyTier(-0.031), "declining");
  assert.equal(classifyTier(-0.5),   "declining");
});

// ── Test 4: Alphabetical tie-break in volume rank ─────────────────────────────

test("volume rank ties broken alphabetically by make name", () => {
  const now = new Date("2024-07-01T00:00:00Z");

  // Both makes have the same total auction count
  const catalog = [
    { slug: "car-a1", make: "Zebra" },
    { slug: "car-a2", make: "Zebra" },
    { slug: "car-b1", make: "Alpha" },
    { slug: "car-b2", make: "Alpha" },
  ];

  const priceAggregates = {
    "car-a1": makeAgg({ price_momentum_12mo: 0.05, auction_count_12mo: 10 }),
    "car-a2": makeAgg({ price_momentum_12mo: 0.07, auction_count_12mo: 10 }),
    "car-b1": makeAgg({ price_momentum_12mo: 0.05, auction_count_12mo: 10 }),
    "car-b2": makeAgg({ price_momentum_12mo: 0.07, auction_count_12mo: 10 }),
  };

  const features = buildBrandFeatures({ catalog, priceAggregates, now });

  // Alphabetically "Alpha" < "Zebra", so Alpha gets rank 1 on a tie
  assert.equal(features["Alpha"].brand_auction_volume_rank, 1);
  assert.equal(features["Zebra"].brand_auction_volume_rank, 2);
});
