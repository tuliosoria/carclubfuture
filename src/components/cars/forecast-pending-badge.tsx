import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Friendly amber pill shown in place of a forecast for vehicles that
 * don't yet have enough auction data to model. Used everywhere the
 * UI would otherwise show fabricated numbers.
 */
export function ForecastPendingBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300",
        className,
      )}
    >
      Forecast · Feature being developed
    </span>
  );
}
