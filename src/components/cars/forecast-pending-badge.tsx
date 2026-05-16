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
      "inline-flex items-center rounded-sm border border-papaya/30 bg-papaya/10 px-2 py-0.5 text-meta uppercase tracking-[0.04em] text-papaya",
        className,
      )}
    >
      Forecast · Feature being developed
    </span>
  );
}
