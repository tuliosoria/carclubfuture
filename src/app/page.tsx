import Link from "next/link";
import { ArrowRight, LineChart, Calculator, Gauge } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <FadeIn>
        <p className="text-sm font-medium uppercase tracking-widest text-accent">
          CarClubFuture
        </p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
          Forecast a collector car&apos;s next 5 years before you buy.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          Buy / Hold / Sell signals, scenario-based value projections, and
          restoration ROI calculators — built on auction data from Bring a
          Trailer and Cars &amp; Bids.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/car-forecast"
            className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-3 font-medium text-accent-foreground hover:opacity-90"
          >
            Browse the catalog <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/car-forecast/methodology"
            className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-3 font-medium text-foreground hover:bg-muted"
          >
            How it works
          </Link>
        </div>
      </FadeIn>

      <div className="mt-24 grid gap-6 sm:grid-cols-3">
        <FeatureCard
          icon={<LineChart className="h-6 w-6 text-accent" />}
          title="Vehicle forecasts"
          body="Pessimist · Moderate · Optimist 5-year value projections with confidence tiers, anchored to Condition #3."
          href="/car-forecast"
        />
        <FeatureCard
          icon={<Gauge className="h-6 w-6 text-accent" />}
          title="Market index"
          body="Stock-market-style segment indexes (Blue Chip, American Muscle, Japanese Icons) with quarterly trends and a 0–100 Market Rating."
          href="/market-index"
        />
        <FeatureCard
          icon={<Calculator className="h-6 w-6 text-accent" />}
          title="ROI calculators"
          body="Restoration, flip, and hold-period ROI for cars you already own — with realistic auction fees and storage costs."
          href="/calculator"
        />
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-border bg-card p-6 transition hover:border-accent/40 hover:bg-muted"
    >
      <div className="flex items-center gap-3">
        {icon}
        <h2 className="text-lg font-semibold text-card-foreground">{title}</h2>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{body}</p>
      <p className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent group-hover:gap-2">
        Explore <ArrowRight className="h-4 w-4 transition" />
      </p>
    </Link>
  );
}
