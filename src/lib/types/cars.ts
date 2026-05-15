/**
 * Shared TypeScript types for the collector car domain.
 * Keep these aligned with the JSON schemas in src/lib/schemas/.
 */

export type Segment =
  | "blue-chip"
  | "american-muscle"
  | "affordable-classics"
  | "german-sport"
  | "japanese-icons"
  | "british-classic"
  | "modern-collectible"
  | "ferrari-italian";

export type Era =
  | "pre-war"
  | "post-war-classic"
  | "muscle-era"
  | "malaise"
  | "modern-classic"
  | "modern-collectible";

export type BodyStyle = "coupe" | "convertible" | "sedan" | "wagon" | "truck" | "suv";

export type ConditionGrade = 1 | 2 | 3 | 4;

export type Scenario = "pessimist" | "moderate" | "optimist";

export type Recommendation = "buy" | "hold" | "sell";

export type Confidence = "high" | "medium" | "low";

export type Rarity = "common" | "limited" | "rare" | "ultra-rare";

export type Market = "north-america" | "restricted";

export interface AuctionComp {
  date: string; // ISO yyyy-mm-dd
  channel: "bat" | "cars-and-bids" | "other";
  soldPriceUsd: number | null;
  reserveMet: boolean | null;
  mileage: number | null;
  conditionGrade: ConditionGrade | null;
  url: string | null;
}

export interface PriceSnapshot {
  asOf: string;
  conditionAnchor: ConditionGrade;
  valueUsd: number;
  auctionMedian12moUsd: number | null;
  auctionCount12mo: number;
  reserveMetRate12mo: number | null;
  source: "oldcarsdata" | "bundled" | "estimate";
}

export interface ProjectionPoint {
  year: number; // years from now (1..5)
  pessimistUsd: number;
  moderateUsd: number;
  optimistUsd: number;
}

export interface CarForecast {
  recommendation: Recommendation;
  confidence: Confidence;
  asOf: string;
  baseValueUsd: number;
  baseConditionGrade: ConditionGrade;
  cagr1yr: number;
  cagr3yr: number;
  cagr5yr: number;
  projection: ProjectionPoint[];
  drivers: string[];
  notes: string[];
  insufficientData?: boolean;
}

export interface CollectorCar {
  id: string; // stable internal id
  slug: string; // URL slug
  carqueryId: string | null; // external CarQuery stable id
  year: number;
  make: string;
  model: string;
  trim: string | null;
  displayName: string;
  segment: Segment;
  era: Era;
  bodyStyle: BodyStyle;
  market: Market;
  rarity: Rarity;
  productionTotal: number | null;
  engineDisplacementCc: number | null;
  cylinders: number | null;
  isConvertible: boolean;
  imageUrl: string | null;
  description: string | null;
  searchAliases: string[];
  /** Latest spot price (Condition #3 anchor). */
  price: PriceSnapshot | null;
  /** Latest forecast — may be null when insufficient data. */
  forecast: CarForecast | null;
  /** Recent auction comps (most recent first). */
  recentComps: AuctionComp[];
}

/**
 * Normalised image record written by the mirror-car-images sync job and
 * read back at request time via getCachedImage(slug).
 *
 * `imageStatus` is "missing" when no Wikimedia or OldCarsData image was found;
 * the limitations report (Phase H) picks these up from missing-images.json.
 *
 * Attribution fields are ALWAYS populated (never null/undefined) to satisfy
 * the legal requirement to display author + license next to every image.
 */
export interface VehicleImage {
  slug: string;
  url: string;
  width: number | null;
  height: number | null;
  source: "wikimedia" | "oldcarsdata" | "missing";
  attribution: {
    author: string;
    license: string; // e.g. "CC-BY-SA-4.0"
    licenseUrl: string;
  };
  imageStatus: "ok" | "missing";
  cachedAt: string; // ISO
}

export interface ConditionMultiplierRow {
  segment: Segment | "default";
  multipliers: Record<ConditionGrade, number>;
}

export interface SegmentIndexPoint {
  quarter: string; // YYYY-Qn
  indexValue: number;
  componentCount: number;
}

export interface SegmentIndex {
  segment: Segment;
  current: number;
  quarterlyChangePct: number;
  componentCount: number;
  history: SegmentIndexPoint[];
}

export interface MarketRating {
  asOf: string;
  score: number; // 0..100
  components: {
    auctionVolumeMomentum: number;
    priceTrend: number;
    privateSaleProxy: number;
  };
}

/**
 * Row shape produced by the bulk CarQuery/NHTSA/CarAPI ingest pipeline.
 * Distinct from CollectorCar — this is the raw enriched catalog row written
 * to cars-catalog-bulk.json. Optional enrichment fields are present only
 * when the relevant API call succeeded.
 */
export interface BulkCatalogRow {
  carqueryId: string;
  slug: string;
  year: number;
  make: string;
  makeDisplay: string;
  model: string;
  trim: string | null;
  bodyStyle: string | null;
  engineDisplacementCc: number | null;
  cylinders: number | null;
  fuel: string | null;
  transmission: string | null;
  driveType: string | null;
  source: "carquery";
  // A5: NHTSA vPIC cross-reference
  nhtsaId?: string | null;
  nhtsaModelName?: string;
  // A6: CarAPI enrichment
  carapiId?: number | string | null;
  engineHp?: number | null;
  engineTorque?: number | null;
  mpgCity?: number | null;
  mpgHwy?: number | null;
  bodySubStyle?: string | null;
  // A7: confidence scoring
  catalogConfidence?: "high" | "medium" | "low";
}

/**
 * Phase C: merged OldCarsData + BaT price aggregates for the ML model.
 * data_status "insufficient" gates forecast_eligible: false downstream.
 */
export interface PriceAggregates {
  /** Most-recent sold price in trailing 90 days. */
  current_price_c3: number | null;
  auction_median_12mo: number | null;
  auction_high_12mo: number | null;
  auction_low_12mo: number | null;
  auction_count_12mo: number;
  auction_median_36mo: number | null;
  auction_count_36mo: number;
  /** Fraction of 12-month auctions where reserve was met (0..1). */
  reserve_met_rate_12mo: number | null;
  mileage_median_sold: number | null;
  /** (median_last_30d - median_30_60d_ago) / median_30_60d_ago */
  price_momentum_1mo: number | null;
  /** (median_last_30d - median_330_360d_ago) / median_330_360d_ago */
  price_momentum_12mo: number | null;
  /** "insufficient" when auction_count_36mo < 5 — gates ML forecast eligibility. */
  data_status: "ok" | "insufficient";
  data_sources: string[];
  computed_at: string;
}
