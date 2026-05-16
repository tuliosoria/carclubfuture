import Link from "next/link";
import { ArrowUpRight, LineChart, Calculator, Gauge } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { getCarBySlug } from "@/lib/db/car-search";
import { resolveCarImage } from "@/lib/domain/car-image";
import imagesJsonRaw from "@/lib/data/cars-ml/oldcarsdata-auction-images.json";
import { SectionHeader } from "@/components/ui/section-header";
interface ImageRecord {
  url?: string;
  source?: string;
  imageStatus?: string;
  width?: number | null;
  height?: number | null;
  author?: string;
  license?: string;
  licenseUrl?: string;
  sourcePageUrl?: string;
}
const imagesJson = imagesJsonRaw as Record<string, ImageRecord>;

function pickHeroSlug(): string | null {
  const eligible: string[] = [];
  for (const [slug, rec] of Object.entries(imagesJson)) {
    if (rec.imageStatus !== "ok") continue;
    if ((rec.width ?? 0) < 1200) continue;
    eligible.push(slug);
  }
  if (eligible.length === 0) return null;
  const day = Math.floor(Date.now() / 86_400_000);
  return eligible[day % eligible.length];
}

export default function HomePage() {
  const heroSlug = pickHeroSlug();
  const heroCar = heroSlug ? getCarBySlug(heroSlug) : null;
  const heroImg = heroCar ? resolveCarImage(heroCar) : null;

  return (
    <>
      {/* HERO */}
      <section className="relative isolate -mt-px overflow-hidden bg-black">
        <div className="relative h-[clamp(600px,80vh,900px)] w-full">
          {heroImg ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroImg.src}
                alt={heroCar?.displayName ?? ""}
                className="absolute inset-0 h-full w-full object-cover opacity-90"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />
            </>
          ) : (
            <div className="absolute inset-0 bg-surface" />
          )}

          <div className="relative z-10 mx-auto flex h-full max-w-[1440px] flex-col justify-end px-4 pb-16 sm:px-8 sm:pb-24">
            <FadeIn>
              <p className="text-overline uppercase text-papaya">
                Collector Car Forecasting
              </p>
              <h1 className="mt-4 font-display text-5xl font-bold uppercase leading-[0.95] tracking-tight text-white sm:text-7xl lg:text-[5.5rem]">
                Buy with<br />conviction.
              </h1>
              <p className="mt-6 max-w-xl text-base text-foreground-muted sm:text-lg">
                5-year value forecasts and Buy / Hold / Sell signals for{" "}
                <span className="font-mono text-white tabular-nums">15,157</span>{" "}
                collectible vehicles. Built on real auction data — no mocks, no
                guesses.
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <Link
                  href="/car-forecast"
                  className="inline-flex h-12 items-center gap-2 rounded-sm bg-papaya px-6 text-sm font-semibold uppercase tracking-[0.04em] text-papaya-foreground transition-colors duration-150 ease-out hover:bg-papaya-hover active:bg-papaya-press"
                >
                  Browse Catalog <ArrowUpRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/car-forecast/methodology"
                  className="inline-flex h-12 items-center gap-2 rounded-sm border border-border-strong bg-transparent px-6 text-sm font-semibold uppercase tracking-[0.04em] text-foreground transition-colors duration-150 ease-out hover:border-papaya hover:text-papaya"
                >
                  How it Works
                </Link>
              </div>
            </FadeIn>
          </div>

          {heroImg?.attribution ? (
            <p className="absolute bottom-3 right-4 z-10 text-[10px] uppercase tracking-[0.08em] text-foreground-dim">
              {heroCar?.displayName} · Photo:{" "}
              <a
                href={heroImg.attribution.sourcePageUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline decoration-dotted hover:text-foreground-muted"
              >
                {heroImg.attribution.author} / {heroImg.attribution.license}
              </a>
            </p>
          ) : null}
        </div>
      </section>

      {/* FEATURES */}
      <section className="mx-auto max-w-[1440px] px-4 py-24 sm:px-8">
        <SectionHeader
          overline="What you get"
          title="The tools"
          subtitle="Forecast, index, and ROI. Three lenses on the same question: is this car going up or down?"
        />
        <div className="mt-12 grid gap-px bg-border sm:grid-cols-3">
          <FeatureCard
            icon={<LineChart className="h-6 w-6" />}
            title="Vehicle Forecasts"
            body="Pessimist · Moderate · Optimist 5-year value projections with confidence tiers, anchored to Condition #3."
            href="/car-forecast"
          />
          <FeatureCard
            icon={<Gauge className="h-6 w-6" />}
            title="Market Index"
            body="Stock-market-style segment indexes (Blue Chip, American Muscle, Japanese Icons) with quarterly trends and a 0–100 Market Rating."
            href="/market-index"
          />
          <FeatureCard
            icon={<Calculator className="h-6 w-6" />}
            title="ROI Calculator"
            body="Restoration, flip, and hold-period ROI for cars you already own — with realistic auction fees and storage costs."
            href="/calculator"
          />
        </div>
      </section>
    </>
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
      className="group flex flex-col bg-surface-elevated p-8 transition-colors duration-150 ease-out hover:bg-surface-overlay"
    >
      <div className="text-papaya">{icon}</div>
      <h3 className="mt-6 font-display text-2xl font-bold uppercase text-foreground">
        {title}
      </h3>
      <p className="mt-3 text-sm text-foreground-muted">{body}</p>
      <p className="mt-6 inline-flex items-center gap-2 text-meta uppercase tracking-[0.04em] text-foreground transition-colors duration-150 ease-out group-hover:text-papaya">
        Explore <ArrowUpRight className="h-4 w-4" />
      </p>
    </Link>
  );
}
