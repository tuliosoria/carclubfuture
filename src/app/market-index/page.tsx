import { loadSegmentIndexes, loadMarketRating } from "@/lib/db/market-index";
import { getSegment } from "@/lib/data/car-segments";
import { SegmentIndexCard } from "@/components/market/segment-index-card";
import { MarketRatingGauge } from "@/components/market/market-rating-gauge";

export const metadata = { title: "Market Index" };
export const dynamic = "force-static";

export default function MarketIndexPage() {
  const segments = loadSegmentIndexes();
  const rating = loadMarketRating();

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-6 py-12">
      <header>
        <p className="text-xs uppercase tracking-wider text-accent">Market Index</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-tight">Collector market dashboard</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Quarterly segment indexes computed from OldCarsData auction medians (Condition #2 anchor).
          Inspired by the Hagerty Market Rating methodology — directional, not predictive.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-[1fr_2fr] md:items-stretch">
        <MarketRatingGauge rating={rating} />
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            How the Market Rating works
          </h2>
          <p className="mt-2 text-sm text-foreground/90">
            A 0–100 composite that blends three signals: auction-volume momentum (12-month change in
            sold counts), directional price trend (median sold-price slope), and a private-sale proxy
            built from search and inquiry traffic. Above 60 is bullish; below 40 is bearish.
          </p>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Volume</dt>
              <dd className="text-lg font-semibold">{rating.components.auctionVolumeMomentum}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Price trend</dt>
              <dd className="text-lg font-semibold">{rating.components.priceTrend}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Private sale</dt>
              <dd className="text-lg font-semibold">{rating.components.privateSaleProxy}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-semibold tracking-tight">Segment indexes</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {segments.map((s) => (
            <SegmentIndexCard
              key={s.segment}
              data={s}
              descriptor={getSegment(s.segment)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
