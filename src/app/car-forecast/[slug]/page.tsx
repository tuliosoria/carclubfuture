import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getCarBySlug, loadStoredCatalog } from "@/lib/db/car-search";
import { hydrateForecast } from "@/lib/domain/car-forecast";
import { buildBatSearchUrl } from "@/lib/domain/car-bat-link";
import { resolveCarImage } from "@/lib/domain/car-image";
import { ForecastChart } from "@/components/cars/forecast-chart";
import { ConditionSelector } from "@/components/cars/condition-selector";
import { AuctionCompsTable } from "@/components/cars/auction-comps-table";
import { ModelDetails } from "@/components/cars/model-details";
import { SignalBadge } from "@/components/cars/signal-badge";
import { ForecastPendingBadge } from "@/components/cars/forecast-pending-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { CONFIDENCE_LABEL, CONFIDENCE_COLOR } from "@/lib/domain/confidence-display";

export const dynamic = "force-static";
// Allow slugs not in generateStaticParams() to render on-demand (ISR).
// We pre-render only the small hand-curated seed list — the 30k+ NHTSA
// rows are generated at first request and then cached.
export const dynamicParams = true;

export function generateStaticParams() {
  // A "seed" row is one where the hand-curated rich metadata is present.
  // Bulk NHTSA rows have null segment/rarity.
  return loadStoredCatalog()
    .filter((c) => c.segment !== null && c.rarity !== null)
    .map((c) => ({ slug: c.slug }));
}

export default async function CarDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const stored = getCarBySlug(slug);
  if (!stored) return notFound();
  const car = hydrateForecast(stored);
  const f = car.forecast;
  const hasForecast = !!(f && !f.insufficientData);
  const final = hasForecast ? f!.projection.at(-1) : null;
  const batUrl = buildBatSearchUrl(car);
  const segmentLabel = car.segment ? car.segment.replace(/-/g, " ") : null;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <Link href="/car-forecast" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to catalog
      </Link>

      <header className="grid gap-6 md:grid-cols-[2fr_1fr] md:items-end">
        <div>
          {segmentLabel || car.bodyStyle ? (
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {[segmentLabel, car.bodyStyle].filter(Boolean).join(" · ")}
            </p>
          ) : (
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Catalog entry</p>
          )}
          <h1 className="mt-1 text-4xl font-semibold tracking-tight">{car.displayName}</h1>
          {car.description ? (
            <p className="mt-3 max-w-prose text-sm text-muted-foreground">{car.description}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {hasForecast ? <SignalBadge recommendation={f!.recommendation} /> : null}
            {hasForecast ? (
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${CONFIDENCE_COLOR[f!.confidence]}`}>
                {CONFIDENCE_LABEL[f!.confidence]}
              </span>
            ) : (
              <ForecastPendingBadge />
            )}
            {batUrl ? (
              <a
                href={batUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1 text-xs hover:border-accent/40 hover:text-accent"
              >
                Bring a Trailer search <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {(() => {
            const img = resolveCarImage(car);
            return (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.src} alt={car.displayName} className="aspect-[16/10] w-full object-cover" />
                {img.attribution ? (
                  <p className="px-3 py-1 text-[11px] leading-tight text-muted-foreground">
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
              </>
            );
          })()}
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Current value (Condition #3)" value={car.price ? formatCurrency(car.price.valueUsd) : "—"} />
        <Stat
          label="5-yr CAGR (moderate)"
          value={hasForecast ? formatPercent(f!.cagr5yr, 1) : "—"}
        />
        <Stat
          label="Projected 5-yr value"
          value={final ? formatCurrency(final.moderateUsd) : "—"}
        />
      </section>

      {hasForecast ? (
        <Card>
          <CardHeader>
            <CardTitle>5-year projection</CardTitle>
          </CardHeader>
          <CardContent>
            <ForecastChart projection={f!.projection} baseValueUsd={f!.baseValueUsd} />
            {f!.drivers.length ? (
              <ul className="mt-4 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                {f!.drivers.map((d) => (
                  <li key={d}>• {d}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <ForecastPendingBadge />
            <p className="max-w-md text-sm text-muted-foreground">
              We don&apos;t yet have enough auction history for this vehicle to publish a
              projection. Forecast modeling is rolling out — check back as more comps land.
            </p>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-6 md:grid-cols-2">
        {car.price && car.segment ? (
          <ConditionSelector segment={car.segment} baseValueUsd={car.price.valueUsd} />
        ) : null}
        <ModelDetails car={car} />
      </section>

      <AuctionCompsTable slug={car.slug} fallbackBaseValue={car.price?.valueUsd ?? 0} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
