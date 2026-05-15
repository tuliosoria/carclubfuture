import type { Recommendation } from "@/lib/types/cars";

export const REC_LABEL: Record<Recommendation, string> = {
  buy: "Buy",
  hold: "Hold",
  sell: "Sell",
};

export const REC_COLOR: Record<Recommendation, string> = {
  buy: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  hold: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  sell: "bg-rose-500/20 text-rose-300 border-rose-500/40",
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
