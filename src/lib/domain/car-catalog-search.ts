/**
 * Catalog search & alias helpers — pure, framework-free.
 */
import type { CollectorCar, Segment } from "@/lib/types/cars";
import { normalize } from "@/lib/utils/string";

const SEGMENT_ALIASES: Record<string, Segment> = {
  "muscle": "american-muscle",
  "muscle car": "american-muscle",
  "muscle cars": "american-muscle",
  "american muscle": "american-muscle",
  "jdm": "japanese-icons",
  "jdm icons": "japanese-icons",
  "japanese": "japanese-icons",
  "japanese icons": "japanese-icons",
  "blue chip": "blue-chip",
  "blue-chip": "blue-chip",
  "affordable classic": "affordable-classics",
  "affordable classics": "affordable-classics",
  "german sport": "german-sport",
  "porsche bmw": "german-sport",
  "british classic": "british-classic",
  "modern collectible": "modern-collectible",
  "ferrari": "ferrari-italian",
  "italian": "ferrari-italian",
};

export function coerceSegment(input: string): Segment | null {
  const k = normalize(input);
  return SEGMENT_ALIASES[k] ?? null;
}

export function buildCarDisplayName(car: Pick<CollectorCar, "year" | "make" | "model" | "trim">): string {
  const parts = [String(car.year), car.make, car.model];
  if (car.trim) parts.push(car.trim);
  return parts.join(" ");
}

export function buildCarSearchAliases(car: Pick<CollectorCar, "make" | "model" | "trim" | "year" | "segment">): string[] {
  const out = new Set<string>();
  out.add(`${car.year} ${car.make} ${car.model}`.toLowerCase());
  out.add(`${car.make} ${car.model}`.toLowerCase());
  out.add(car.model.toLowerCase());
  if (car.trim) out.add(`${car.model} ${car.trim}`.toLowerCase());
  if (car.segment) out.add(car.segment);
  return Array.from(out);
}
