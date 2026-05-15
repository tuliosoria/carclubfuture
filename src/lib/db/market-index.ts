import segmentIndexJson from "@/lib/data/cars-ml/segment-index.json";
import marketRatingJson from "@/lib/data/cars-ml/market-rating.json";
import type { SegmentIndex, MarketRating } from "@/lib/types/cars";

interface SegmentIndexFile {
  asOf: string;
  segments: SegmentIndex[];
}

const indexData = segmentIndexJson as unknown as SegmentIndexFile;
const ratingData = marketRatingJson as unknown as MarketRating;

export function loadSegmentIndexes(): SegmentIndex[] {
  return indexData.segments;
}

export function loadMarketRating(): MarketRating {
  return ratingData;
}
