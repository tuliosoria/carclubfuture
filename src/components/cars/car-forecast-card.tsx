import * as React from "react";
import type { CollectorCar, Scenario } from "@/lib/types/cars";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignalBadge } from "./signal-badge";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { CONFIDENCE_COLOR, CONFIDENCE_LABEL } from "@/lib/domain/confidence-display";
import { cn } from "@/lib/utils";
import { resolveCarImage } from "@/lib/domain/car-image";

export function CarForecastCard({ car, scenario = "moderate" as Scenario }: { car: CollectorCar; scenario?: Scenario }) {
  const f = car.forecast;
  const final = f?.projection.at(-1);
  const projected = final
    ? scenario === "pessimist"
      ? final.pessimistUsd
      : scenario === "optimist"
      ? final.optimistUsd
      : final.moderateUsd
    : null;
  const upsidePct = projected && car.price ? projected / car.price.valueUsd - 1 : null;
  const img = resolveCarImage(car);

  return (
    <Card className="overflow-hidden transition hover:border-accent/40">
      <div className="aspect-[16/9] w-full overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.src}
          alt={car.displayName}
          className="h-full w-full object-cover opacity-90"
          loading="lazy"
        />
      </div>
      {img.attribution ? (
        <p className="px-3 pt-1 text-[10px] leading-tight text-muted-foreground">
          Photo:{" "}
          <a
            href={img.attribution.sourcePageUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-dotted hover:text-foreground"
          >
            {img.attribution.author} / {img.attribution.license}
          </a>{" "}
          (Wikimedia Commons)
        </p>
      ) : null}
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{car.displayName}</CardTitle>
          {f ? <SignalBadge recommendation={f.recommendation} /> : null}
        </div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {car.segment.replace(/-/g, " ")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Current value (#3)</p>
            <p className="font-medium text-foreground">{formatCurrency(car.price?.valueUsd ?? 0, { compact: true })}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">5-yr {scenario}</p>
            <p className="font-medium text-foreground">
              {projected ? formatCurrency(projected, { compact: true }) : "—"}
              {upsidePct !== null ? (
                <span className={cn("ml-1 text-xs", upsidePct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  ({formatPercent(upsidePct, 0)})
                </span>
              ) : null}
            </p>
          </div>
        </div>
        {f ? (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
              CONFIDENCE_COLOR[f.confidence]
            )}
          >
            {CONFIDENCE_LABEL[f.confidence]}
          </span>
        ) : null}
        {f?.insufficientData ? (
          <p className="text-xs text-amber-300">Insufficient auction data — projection withheld.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SkeletonForecastCard() {
  return (
    <Card>
      <div className="aspect-[16/9] w-full animate-pulse bg-muted" />
      <CardHeader>
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-10 w-full animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}
