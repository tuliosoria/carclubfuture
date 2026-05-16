import type { MarketRating } from "@/lib/types/cars";
import { cn } from "@/lib/utils";

export function MarketRatingGauge({ rating }: { rating: MarketRating }) {
  const score = Math.max(0, Math.min(100, rating.score));
  // Half-circle gauge: -90deg to +90deg
  const angle = (score / 100) * 180 - 90;
  const tone =
    score >= 60 ? "text-buy" : score <= 40 ? "text-sell" : "text-hold";
  return (
    <div className="rounded-lg border border-border bg-card p-6 text-center">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Market Rating</p>
      <div className="relative mx-auto mt-4 h-32 w-56 overflow-hidden">
        <svg viewBox="0 0 200 100" className="h-full w-full">
          <path d="M10 100 A 90 90 0 0 1 190 100" fill="none" stroke="#27272a" strokeWidth="14" strokeLinecap="round" />
          <path
            d="M10 100 A 90 90 0 0 1 190 100"
            fill="none"
            stroke="currentColor"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 283} 283`}
            className={tone}
          />
          <line
            x1="100"
            y1="100"
            x2="100"
            y2="20"
            stroke="#fafafa"
            strokeWidth="2"
            transform={`rotate(${angle} 100 100)`}
          />
          <circle cx="100" cy="100" r="4" fill="#fafafa" />
        </svg>
      </div>
      <p className={cn("mt-2 text-4xl font-semibold tabular-nums", tone)}>{score}</p>
      <p className="text-xs text-muted-foreground">As of {rating.asOf}</p>
    </div>
  );
}
