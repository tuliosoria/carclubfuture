# CarClubFuture

A value-forecasting and Buy/Hold/Sell decision engine for collectible
and classic cars — American Muscle, Blue Chip, Affordable Classics,
German Sport, Japanese Icons, British Classic, and Modern Collectible.

Live host: AWS Amplify (`https://main.<app-id>.amplifyapp.com` after
connect).

## What's inside

- **`/car-forecast`** — searchable, filterable catalog with sticky
  sidebar (Segment / Era / Body / Recommendation / Scenario / Sort).
  Each card shows a Buy / Hold / Sell signal, current Condition #3
  value, 5-year projection range, and a confidence tier.
- **`/car-forecast/[slug]`** — Bloomberg-style detail page: ROI chart
  (Pessimist / Moderate / Optimist), condition selector (#1–#4),
  recent auction comps, BaT search link, model details.
- **`/car-forecast/methodology`** — plain-English explanation of the
  model, sources, confidence, and condition grades.
- **`/market-index`** — segment dashboard (7 cards + Market Rating
  gauge), inspired by the Hagerty Market Rating methodology.
- **`/calculator`** — Restoration ROI / Flip ROI / Hold ROI tabs.
- **APIs** under `/api/cars/*`, `/api/market/*`, `/api/health`.

## Tech stack

- **Next.js 16** (App Router, RSC) + React 19 + TypeScript
- **Tailwind CSS v4** (`@tailwindcss/postcss`)
- `recharts`, `lucide-react`, `react-hook-form` + `zod`
- AWS SDK v3 (DynamoDB single-table cache)
- Python 3.11 + **XGBoost 2.1.4** for offline ML training

## Quickstart

```bash
nvm use 22
npm ci
npm run dev          # http://localhost:3000
```

The app boots with **no env vars and no DynamoDB** — bundled JSON in
`src/lib/data/cars-ml/` is the source of truth.

## Useful commands

```bash
npm run verify              # lint + build + script syntax (pre-push hook)
npm run lint                # eslint .
npm run build               # next build
npm run sync:cars:catalog   # rebuild canonical car catalog
npm run sync:cars:segments  # rebuild segment-catalog.json
npm run sync:oldcarsdata    # pull live OldCarsData prices (needs API key)
npm run train:cars-ml       # retrain XGBoost models locally
```

## Architecture

```
Browser ──► Next.js 16 (Amplify, WEB_COMPUTE)
                │
                ├── Bundled JSON (src/lib/data/cars-ml/)  ← source of truth
                ├── DynamoDB single-table cache           ← hot tier
                └── OldCarsData API                       ← live prices
```

Tiered read pattern: L0 memory → L1 DynamoDB → L2 bundled JSON → L3
OldCarsData API. Site degrades gracefully when DynamoDB or the API
key is unavailable.

## Data sources

- **OldCarsData** — primary, BaT + Cars & Bids auction results
- **CarQuery** — catalog metadata (year/make/model/trim/specs) only;
  never used for prices
- **NHTSA** — VIN decode, production totals, recalls
- **Bring a Trailer** — search URL resolver only (rate-limited)
- **Reddit + Google Trends** — community-demand signal blend

## Deployment

See [`Specs-Driven/DEPLOY_AWS.md`](./Specs-Driven/DEPLOY_AWS.md) for
the Amplify connect, env-var, DynamoDB provisioning, and (optional)
quarterly retrainer Lambda runbook.

## Project layout

```
src/app/              # Next.js App Router pages + API routes
src/components/       # UI: cars/, market/, calculator/, layout/, ui/
src/lib/data/cars-ml/ # All committed JSON + model artifacts
src/lib/db/           # DynamoDB clients, search, model loader
src/lib/domain/       # Forecast, recommendation, calculators, conditions
scripts/              # All sync / train / backfill scripts
infra/                # cars-ml-retrainer Lambda (Dockerfile + SAM)
```

## License

Proprietary. © CarClubFuture.
