import * as React from "react";
import type { CollectorCar, Scenario } from "@/lib/types/cars";
import { Card } from "@/components/ui/card";
import { SignalBadge } from "./signal-badge";
import { ForecastPendingBadge } from "./forecast-pending-badge";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { CONFIDENCE_COLOR, CONFIDENCE_LABEL } from "@/lib/domain/confidence-display";
import { cn } from "@/lib/utils";
import { resolveCarImage } from "@/lib/domain/car-image";
import { ArrowUpRight } from "lucide-react";

export function CarForecastCard({ car, scenario = "moderate" as Scenario }: { car: CollectorCar; scenario?: Scenario }) {
  const f = car.forecast;
  const hasForecast = !!(f && !f.insufficientData);
  const final = hasForecast ? f!.projection.at(-1) : null;
  const projected = final
    ? scenario === "pessimist"
      ? final.pessimistUsd
      : scenario === "optimist"
      ? final.optimistUsd
      : final.moderateUsd
    : null;
  const upsidePct = projected && car.price ? projected / car.price.valueUsd - 1 : null;
  const img = resolveCarImage(car);
  const segmentLabel = car.segment ? car.segment.replace(/-/g, " ") : "catalog entry";

  return (
    <Card className="group relative flex h-full flex-col overflow-hidden hover:border-papaya">
      <div className="aspect-[16/9] w-full overflow-hidden bg-surface">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.src}
          alt={car.displayName}
          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
          loading="lazy"
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="text-overline uppercase text-papaya">{segmentLabel}</div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-bold uppercase leading-tight text-foreground">
            {car.displayName}
          </h3>
          {hasForecast ? <SignalBadge recommendation={f!.recommendation} /> : null}
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <p className="text-meta uppercase text-foreground-dim">Value (#3)</p>
            <p className="font-mono text-num-md text-foreground tabular-nums">
              {car.price ? formatCurrency(car.price.valueUsd, { compact: true }) : "—"}
            </p>
          </div>
          <div>
            <p className="text-meta uppercase text-foreground-dim">5-yr {scenario}</p>
            <p className="font-mono text-num-md tabular-nums">
              <span className="text-foreground">
                {projected ? formatCurrency(projected, { compact: true }) : "—"}
              </span>
              {upsidePct !== null ? (
                <span className={cn("ml-1 text-sm", upsidePct >= 0 ? "text-papaya" : "text-sell")}>
                  {formatPercent(upsidePct, 0)}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between pt-2">
          {hasForecast ? (
            <span
              className={cn(
                "inline-flex items-center rounded-sm border px-2 py-0.5 text-meta uppercase",
                CONFIDENCE_COLOR[f!.confidence]
              )}
            >
              {CONFIDENCE_LABEL[f!.confidence]}
            </span>
          ) : (
            <ForecastPendingBadge />
          )}
          <ArrowUpRight
            aria-hidden
            className="h-5 w-5 text-foreground-muted transition-colors duration-150 ease-out group-hover:text-papaya"
          />
        </div>
        {img.attribution ? (
          <p className="border-t border-border pt-2 text-[10px] leading-tight text-foreground-dim">
            Photo:{" "}
            <a
              href={img.attribution.sourcePageUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-dotted hover:text-foreground-muted"
              onClick={(e) => e.stopPropagation()}
            >
              {img.attribution.author} / {img.attribution.license}
            </a>{" "}
            ({img.attribution.source === "wikipedia" ? "Wikipedia" : "Wikimedia Commons"})
          </p>
        ) : null}
      </div>
    </Card>
  );
}

export function SkeletonForecastCard() {
  return (
    <Card>
      <div className="aspect-[16/9] w-full animate-pulse bg-surface" />
      <div className="space-y-2 p-5">
        <div className="h-3 w-1/3 animate-pulse bg-surface" />
        <div className="h-4 w-3/4 animate-pulse bg-surface" />
        <div className="h-10 w-full animate-pulse bg-surface" />
      </div>
    </Card>
  );
}
