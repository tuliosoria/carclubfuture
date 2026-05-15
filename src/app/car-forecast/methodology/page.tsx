import * as React from "react";
import Link from "next/link";

export const metadata = { title: "Methodology" };

export default function MethodologyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header>
        <p className="text-xs uppercase tracking-wider text-accent">Methodology</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-tight">How we forecast collector car values</h1>
        <p className="mt-3 text-muted-foreground">
          A plain-English walkthrough of the model behind every Buy / Hold / Sell signal on
          CarClubFuture.
        </p>
      </header>

      <Section title="1. Where prices come from">
        <p>
          The single source of truth for prices is <strong>OldCarsData</strong>, which aggregates
          Bring a Trailer and Cars &amp; Bids auction outcomes (sold price, reserve status,
          mileage, condition). Catalog metadata — year, make, model, trim, engine specs — comes from
          CarQuery and NHTSA. We do not use dealer asking prices as primary inputs.
        </p>
      </Section>

      <Section title="2. Condition anchor">
        <p>
          All forecasts are anchored to <strong>Condition #3 (Good)</strong> — a presentable,
          drivable example with no major flaws. From that base we apply
          segment-aware multipliers for #1 Concours, #2 Excellent, and #4 Fair grades. Multipliers
          are stored in <code>condition-multipliers.json</code> — never hard-coded.
        </p>
      </Section>

      <Section title="3. The model">
        <p>
          We train an <strong>XGBoost regression stack</strong> with 1-year, 3-year, and 5-year
          horizons. The 5-year is a meta-model that consumes out-of-fold predictions from the 1y
          and 3y models as additional features. We validate using time-series cross-validation
          (scikit-learn <code>TimeSeriesSplit</code>) so we never leak future data into past
          predictions.
        </p>
        <p>
          Inputs include trailing 12-month auction medians, reserve-met rate, segment trends,
          community demand (Reddit + Google Trends), production rarity, and macro correlates
          (S&amp;P 500, gold).
        </p>
      </Section>

      <Section title="4. Scenarios">
        <p>
          From the model we derive three projections:
        </p>
        <ul className="ml-6 list-disc space-y-1 text-sm">
          <li><strong>Pessimist</strong> — the lower bound of the prediction band.</li>
          <li><strong>Moderate</strong> — the central forecast.</li>
          <li><strong>Optimist</strong> — the upper bound.</li>
        </ul>
      </Section>

      <Section title="5. Confidence">
        <p>
          High / Medium / Low based on auction history density (more comps ⇒ more confidence),
          peer-group strength, and signal agreement between the three horizons. Vehicles with
          fewer than 5 auction results in the trailing 36 months are flagged{" "}
          <em>insufficient data</em> and we withhold a projection.
        </p>
      </Section>

      <Section title="6. Buy / Hold / Sell">
        <p>
          The recommendation compares forecasted CAGR against a hold-cost threshold (storage,
          insurance, opportunity cost). Above threshold ⇒ Buy. Below ⇒ Sell. Within band ⇒ Hold.
          Ultra-rare vehicles (&lt; 100 confirmed production units) are never assigned a Buy
          signal — too illiquid to forecast reliably.
        </p>
      </Section>

      <Section title="7. Catalog policy">
        <p>
          North American market only. Salvage, flood, and rebuilt titles are filtered from the
          default view via a denylist applied at load time.
        </p>
      </Section>

      <p className="border-t border-border pt-6 text-sm text-muted-foreground">
        Forecasts are estimates, not guarantees. Read the{" "}
        <Link href="/terms" className="text-accent hover:underline">terms</Link> before acting on
        any signal.
      </p>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-3 text-foreground/90">{children}</div>
    </section>
  );
}
