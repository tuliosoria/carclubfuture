/**
 * Resolves a vehicle image with optional attribution metadata.
 *
 * Source priority:
 *   1. Wikimedia Commons mirror recorded in oldcarsdata-auction-images.json
 *      (filled by scripts/mirror-car-images.mjs). Returns CC-BY/SA
 *      attribution that callers MUST render next to the image.
 *   2. Inline car.imageUrl (manual / curated)
 *   3. Per-segment SVG fallback under /images/fallback/
 */
import type { CollectorCar, Segment } from "@/lib/types/cars";
import imagesIndex from "@/lib/data/cars-ml/oldcarsdata-auction-images.json";

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

export type ImageAttribution = {
  source: "wikimedia";
  author: string;
  license: string;
  sourcePageUrl: string;
};

export type ResolvedImage = {
  src: string;
  attribution: ImageAttribution | null;
};

type MirrorEntry = {
  url: string;
  source: "wikimedia";
  sourcePageUrl: string;
  license: string;
  author: string;
};

const INDEX = imagesIndex as Record<string, MirrorEntry>;

export function resolveCarImage(
  car: Pick<CollectorCar, "imageUrl" | "segment"> & { slug?: string }
): ResolvedImage {
  const slug = car.slug;
  if (slug && INDEX[slug]?.url) {
    const m = INDEX[slug];
    return {
      src: m.url,
      attribution: {
        source: "wikimedia",
        author: m.author,
        license: m.license,
        sourcePageUrl: m.sourcePageUrl,
      },
    };
  }
  return { src: car.imageUrl ?? SEGMENT_FALLBACK[car.segment], attribution: null };
}
