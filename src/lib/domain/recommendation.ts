import type { Recommendation } from "@/lib/types/cars";

export const REC_LABEL: Record<Recommendation, string> = {
  buy: "Buy",
  hold: "Hold",
  sell: "Sell",
};

export const REC_COLOR: Record<Recommendation, string> = {
  buy: "bg-buy/15 text-buy border-buy/40",
  hold: "bg-hold/15 text-hold border-hold/40",
  sell: "bg-sell/15 text-sell border-sell/40",
};

/**
 * Buy/Hold/Sell from forecasted CAGR vs hold-cost threshold.
 * Storage + insurance baseline ~ 3% per year for an enthusiast vehicle.
 */
export const HOLD_COST_THRESHOLD = 0.03;

export function recommendationFromCagr(cagr5yr: number): Recommendation {
  if (cagr5yr >= HOLD_COST_THRESHOLD + 0.04) return "buy"; // outpaces hold cost meaningfully
  if (cagr5yr <= -0.01) return "sell";
  return "hold";
}
