import type { Confidence } from "@/lib/types/cars";

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export const CONFIDENCE_COLOR: Record<Confidence, string> = {
  high: "bg-buy/10 text-buy border-buy/30",
  medium: "bg-hold/10 text-hold border-hold/30",
  low: "bg-sell/10 text-sell border-sell/30",
};

/**
 * Confidence is derived from auction history density, segment liquidity,
 * and signal agreement. This is the runtime classifier consumed by the UI.
 */
export function classifyConfidence(input: {
  auctionCount12mo: number;
  reserveMetRate12mo: number | null;
  rarityScore: number; // 0..1, higher = rarer => harder to forecast
}): Confidence {
  const liquidityOk = input.auctionCount12mo >= 12;
  const rateOk = (input.reserveMetRate12mo ?? 0) >= 0.6;
  if (liquidityOk && rateOk && input.rarityScore < 0.7) return "high";
  if (input.auctionCount12mo >= 5 && input.rarityScore < 0.85) return "medium";
  return "low";
}
