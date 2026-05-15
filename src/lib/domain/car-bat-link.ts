/**
 * Resolve the canonical Bring a Trailer search URL for a given vehicle.
 * The resolver builds a query that targets the Year + Make + Model and
 * disqualifies parts/dealer landing pages by inspecting the HTML title.
 *
 * In the bundled fallback (no network), we synthesize a deterministic
 * search URL — good enough for the UI; the live validator script
 * (scripts/validate-bat-links.mjs) confirms it actually resolves.
 */
import type { CollectorCar } from "@/lib/types/cars";
import { slugify } from "@/lib/utils/string";

const BAT_BASE = "https://bringatrailer.com/?s=";

const PARTS_KEYWORDS = ["parts", "wheels", "engine only", "literature", "brochure"];

export function buildBatSearchUrl(car: Pick<CollectorCar, "year" | "make" | "model" | "trim">): string {
  const q = [car.year, car.make, car.model, car.trim].filter(Boolean).join(" ");
  return `${BAT_BASE}${encodeURIComponent(q)}&type=auctions`;
}

export function isLikelyVehiclePageTitle(title: string): boolean {
  const t = title.toLowerCase();
  return !PARTS_KEYWORDS.some((k) => t.includes(k));
}

export function batSlug(car: Pick<CollectorCar, "year" | "make" | "model" | "trim">): string {
  return slugify([car.year, car.make, car.model, car.trim].filter(Boolean).join(" "));
}
