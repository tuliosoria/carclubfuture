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
