/**
 * Bundled-JSON catalog loader. Applies the title denylist, joins seed
 * prices and community scores, and produces fully-hydrated `CollectorCar`
 * records ready for the UI.
 */
import catalogJson from "@/lib/data/cars-ml/cars-catalog.json";
import pricesJson from "@/lib/data/cars-ml/oldcarsdata-current-prices.json";
import communityJson from "@/lib/data/cars-ml/community-score.json";
import denylistJson from "@/lib/data/cars-ml/cars-catalog-title-denylist.json";
import searchAliasesJson from "@/lib/data/cars-ml/cars-search-catalog.json";
import type {
  CollectorCar,
  PriceSnapshot,
  Segment,
} from "@/lib/types/cars";
import { tokenize } from "@/lib/utils/string";

interface CatalogVehicleRow {
  id: string;
  slug: string;
  carqueryId: string | null;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  displayName: string;
  segment: Segment;
  era: CollectorCar["era"];
  bodyStyle: CollectorCar["bodyStyle"];
  market: CollectorCar["market"];
  rarity: CollectorCar["rarity"];
  productionTotal: number | null;
  engineDisplacementCc: number | null;
  cylinders: number | null;
  isConvertible: boolean;
  imageUrl: string | null;
  description: string | null;
}

interface PriceRow {
  asOf: string;
  conditionAnchor: 1 | 2 | 3 | 4;
  valueUsd: number;
  auctionMedian12moUsd: number | null;
  auctionCount12mo: number;
  reserveMetRate12mo: number | null;
}

const catalog = catalogJson as { vehicles: CatalogVehicleRow[] };
const prices = pricesJson as { prices: Record<string, PriceRow> };
const communityScores = communityJson as {
  scores: Record<string, { score: number }>;
};
const denylist = new Set(
  (denylistJson as { denylist: string[] }).denylist.map((s) => s.toLowerCase())
);
const aliasMap = (searchAliasesJson as { aliases: Record<string, string[]> }).aliases;

function buildAliases(row: CatalogVehicleRow): string[] {
  const tokens = new Set<string>();
  tokens.add(row.make.toLowerCase());
  tokens.add(row.model.toLowerCase());
  tokens.add(`${row.make} ${row.model}`.toLowerCase());
  tokens.add(`${row.year} ${row.make} ${row.model}`.toLowerCase());
  if (row.trim) tokens.add(`${row.model} ${row.trim}`.toLowerCase());
  for (const alias of aliasMap[row.id] ?? []) tokens.add(alias.toLowerCase());
  return Array.from(tokens);
}

function priceFor(id: string): PriceSnapshot | null {
  const row = prices.prices[id];
  if (!row) return null;
  return {
    asOf: row.asOf,
    conditionAnchor: row.conditionAnchor,
    valueUsd: row.valueUsd,
    auctionMedian12moUsd: row.auctionMedian12moUsd,
    auctionCount12mo: row.auctionCount12mo,
    reserveMetRate12mo: row.reserveMetRate12mo,
    source: "bundled",
  };
}

let cached: CollectorCar[] | null = null;

export function loadStoredCatalog(): CollectorCar[] {
  if (cached) return cached;
  const cars: CollectorCar[] = [];
  for (const row of catalog.vehicles) {
    if (denylist.has(row.id.toLowerCase())) continue;
    cars.push({
      ...row,
      searchAliases: buildAliases(row),
      price: priceFor(row.id),
      forecast: null, // computed on demand by domain layer
      recentComps: [],
    });
  }
  cached = cars;
  return cars;
}

export function getCarBySlug(slug: string): CollectorCar | null {
  return loadStoredCatalog().find((c) => c.slug === slug) ?? null;
}

export function getCommunityScore(id: string): number | null {
  return communityScores.scores[id]?.score ?? null;
}

/** Lightweight inverted-index search over name + aliases. */
export function searchCatalog(query: string): CollectorCar[] {
  const all = loadStoredCatalog();
  const q = query.trim();
  if (!q) return all;
  const tokens = tokenize(q);
  if (tokens.length === 0) return all;
  return all.filter((car) => {
    const haystack = [car.displayName, ...car.searchAliases].join(" ").toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}
