/**
 * Forecast computation — synthesizes a CarForecast from the bundled
 * price snapshot, community score, and segment characteristics. This is
 * the runtime fallback used until the XGBoost models from Phase 9 are
 * loaded; once `loadCarsMlModels()` returns real artifacts, the same
 * shape is produced by the stacked model.
 */
import type {
  CarForecast,
  CollectorCar,
  ProjectionPoint,
  Segment,
} from "@/lib/types/cars";
import { classifyConfidence } from "./confidence-display";
import { recommendationFromCagr } from "./recommendation";
import { getCommunityScore } from "@/lib/db/car-search";
import marketcheckRaw from "@/lib/data/cars-ml/marketcheck-stats.json";

const MARKETCHECK_STATS = (marketcheckRaw as { stats: Record<string, MarketcheckStat> }).stats ?? {};

interface MarketcheckStat {
  source: "marketcheck";
  asOf: string;
  askMedianUsd: number | null;
  askMeanUsd: number | null;
  askIqrUsd: number | null;
  domMedianDays: number | null;
  domMeanDays: number | null;
  milesMedianMi: number | null;
  listingCount: number;
  cpoCount: number;
}

const MIN_AUCTIONS_36MO = 5;

interface SegmentBaseline {
  baseCagr: number; // long-run trend
  volatility: number; // sigma applied for pessimist/optimist bands
}

const SEGMENT_BASELINE: Record<Segment, SegmentBaseline> = {
  "blue-chip": { baseCagr: 0.04, volatility: 0.05 },
  "american-muscle": { baseCagr: 0.05, volatility: 0.07 },
  "affordable-classics": { baseCagr: 0.06, volatility: 0.08 },
  "german-sport": { baseCagr: 0.06, volatility: 0.07 },
  "japanese-icons": { baseCagr: 0.09, volatility: 0.09 },
  "british-classic": { baseCagr: 0.03, volatility: 0.06 },
  "modern-collectible": { baseCagr: 0.07, volatility: 0.10 },
  "ferrari-italian": { baseCagr: 0.05, volatility: 0.07 },
};

function rarityScore(car: CollectorCar): number {
  switch (car.rarity) {
    case "ultra-rare":
      return 0.95;
    case "rare":
      return 0.75;
    case "limited":
      return 0.5;
    default:
      return 0.25;
  }
}

function compoundProjection(baseValue: number, baseCagr: number, sigma: number): ProjectionPoint[] {
  const points: ProjectionPoint[] = [];
  for (let year = 1; year <= 5; year++) {
    const moderate = baseValue * Math.pow(1 + baseCagr, year);
    const pessimist = baseValue * Math.pow(1 + baseCagr - sigma, year);
    const optimist = baseValue * Math.pow(1 + baseCagr + sigma, year);
    points.push({
      year,
      pessimistUsd: Math.round(pessimist),
      moderateUsd: Math.round(moderate),
      optimistUsd: Math.round(optimist),
    });
  }
  return points;
}

export function computeForecast(car: CollectorCar): CarForecast {
  let price = car.price;
  let priceSource: "oldcarsdata" | "marketcheck-ask" = "oldcarsdata";

  // Fallback: if OldCarsData is missing or thin, try Marketcheck asking-price stats.
  // Marketcheck is dealer-listing aggregate (asking, not sold). Clearly labeled in notes/drivers.
  const mcStat = MARKETCHECK_STATS[car.id];
  if ((!price || price.auctionCount12mo < MIN_AUCTIONS_36MO) && mcStat?.askMedianUsd && mcStat.listingCount >= 3) {
    price = {
      asOf: mcStat.asOf,
      conditionAnchor: 3,
      valueUsd: mcStat.askMedianUsd,
      auctionMedian12moUsd: mcStat.askMedianUsd,
      auctionCount12mo: mcStat.listingCount,
      // Approximate "reserve met rate" from days-on-market: faster sales => stronger demand.
      // <90d=hot(0.85), 90-180d=normal(0.65), >180d=soft(0.45).
      reserveMetRate12mo:
        (mcStat.domMedianDays ?? 180) < 90 ? 0.85 :
        (mcStat.domMedianDays ?? 180) < 180 ? 0.65 : 0.45,
      source: "estimate",
    };
    priceSource = "marketcheck-ask";
  }

  if (!price) {
    return insufficient(car, "No bundled price snapshot.");
  }
  if (price.auctionCount12mo < (priceSource === "marketcheck-ask" ? 3 : MIN_AUCTIONS_36MO)) {
    return insufficient(car, `Only ${price.auctionCount12mo} data points in trailing 12 months.`);
  }
  if (!car.segment) {
    return insufficient(car, "No segment classification on bulk catalog entry.");
  }
  const baseline = SEGMENT_BASELINE[car.segment];

  // Demand tilt: community score nudges baseCagr up to ±2 percentage points.
  const community = getCommunityScore(car.id) ?? 50;
  const demandTilt = ((community - 60) / 60) * 0.02; // centered around 60
  // Marketcheck-derived forecasts: dampen the baseline 1 percentage point because
  // asking-price trends overstate sold-price reality.
  const sourceAdj = priceSource === "marketcheck-ask" ? -0.01 : 0;
  const baseCagr = baseline.baseCagr + demandTilt + sourceAdj;

  // Reserve-met rate dampens volatility (more bidder agreement => narrower bands).
  const reserveAdj = price.reserveMetRate12mo ?? 0.5;
  // Widen bands for Marketcheck-based forecasts to reflect lower confidence.
  const sourceSigmaMult = priceSource === "marketcheck-ask" ? 1.3 : 1.0;
  const sigma = baseline.volatility * (1 + (0.7 - reserveAdj)) * sourceSigmaMult;

  const projection = compoundProjection(price.valueUsd, baseCagr, sigma);
  const final = projection[projection.length - 1];
  const cagr5yr = Math.pow(final.moderateUsd / price.valueUsd, 1 / 5) - 1;
  const cagr3yr =
    Math.pow(projection[2].moderateUsd / price.valueUsd, 1 / 3) - 1;
  const cagr1yr = projection[0].moderateUsd / price.valueUsd - 1;

  const confidence = classifyConfidence({
    auctionCount12mo: price.auctionCount12mo,
    reserveMetRate12mo: price.reserveMetRate12mo,
    rarityScore: rarityScore(car),
  });

  const drivers = [
    `Segment baseline CAGR ${(baseline.baseCagr * 100).toFixed(1)}%`,
    `Community score ${community} (${community >= 80 ? "strong" : community >= 60 ? "stable" : "soft"} demand)`,
    priceSource === "marketcheck-ask"
      ? `${mcStat?.listingCount ?? 0} dealer listings, median DOM ${mcStat?.domMedianDays ?? "?"}d (Marketcheck asking-price)`
      : `12-mo reserve-met rate ${((price.reserveMetRate12mo ?? 0) * 100).toFixed(0)}%`,
    `Rarity: ${car.rarity}`,
  ];

  const notes =
    priceSource === "marketcheck-ask"
      ? ["Forecast based on dealer asking-price data (Marketcheck), not auction-sold results. Treat as directional."]
      : [];

  return {
    recommendation: recommendationFromCagr(cagr5yr),
    confidence: priceSource === "marketcheck-ask" ? "low" : confidence,
    asOf: price.asOf,
    baseValueUsd: price.valueUsd,
    baseConditionGrade: 3,
    cagr1yr,
    cagr3yr,
    cagr5yr,
    projection,
    drivers,
    notes,
  };
}

function insufficient(car: CollectorCar, why: string): CarForecast {
  return {
    recommendation: "hold",
    confidence: "low",
    asOf: car.price?.asOf ?? new Date().toISOString().slice(0, 10),
    baseValueUsd: car.price?.valueUsd ?? 0,
    baseConditionGrade: 3,
    cagr1yr: 0,
    cagr3yr: 0,
    cagr5yr: 0,
    projection: [],
    drivers: [],
    notes: ["Insufficient auction data for a confident forecast.", why],
    insufficientData: true,
  };
}

export function hydrateForecast(car: CollectorCar): CollectorCar {
  return { ...car, forecast: computeForecast(car) };
}
