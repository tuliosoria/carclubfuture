/**
 * Resolves a vehicle image URL with a stable per-segment fallback.
 * Real images are mirrored into /public/images/ by scripts/mirror-car-images.mjs.
 */
import type { CollectorCar, Segment } from "@/lib/types/cars";

const SEGMENT_FALLBACK: Record<Segment, string> = {
  "blue-chip": "/images/fallback/blue-chip.svg",
  "american-muscle": "/images/fallback/american-muscle.svg",
  "affordable-classics": "/images/fallback/affordable-classics.svg",
  "german-sport": "/images/fallback/german-sport.svg",
  "japanese-icons": "/images/fallback/japanese-icons.svg",
  "british-classic": "/images/fallback/british-classic.svg",
  "modern-collectible": "/images/fallback/modern-collectible.svg",
  "ferrari-italian": "/images/fallback/ferrari-italian.svg",
};

export function resolveCarImage(car: Pick<CollectorCar, "imageUrl" | "segment">): string {
  return car.imageUrl ?? SEGMENT_FALLBACK[car.segment];
}
