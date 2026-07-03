# CarClubFuture — Agent Instructions

Value-forecasting and Buy/Hold/Sell decision engine for collectible / classic cars (American Muscle, Blue Chip, Affordable Classics, German Sport, Japanese Icons, British Classic, Modern Collectible).

Sister project to PokeFuture (`~/pokefuture`) — same architectural DNA (Next.js App Router + tiered data + Amplify) applied to cars.

## Stack

- **Next.js 16** App Router + React 19 + **TypeScript**
- **Tailwind CSS v4** (`@tailwindcss/postcss`)
- `recharts`, `lucide-react`, `react-hook-form` + `zod`
- **XGBoost** models (Python) served through bundled JSON artifacts
- **DynamoDB** single-table cache
- **AWS Amplify** (`WEB_COMPUTE`) hosting

## Repo layout

```
src/app/              # Next.js App Router pages + API routes (/car-forecast, /market-index, /calculator, /api/cars/*, /api/market/*)
src/components/       # UI: cars/, market/, calculator/, layout/, ui/
src/lib/data/cars-ml/ # All committed JSON + model artifacts (source of truth)
src/lib/db/           # DynamoDB clients, search, model loader
src/lib/domain/       # Forecast, recommendation, calculators, condition grades
scripts/              # All sync / train / backfill scripts (mjs + python)
infra/                # cars-ml-retrainer Lambda (Dockerfile + SAM)
tests/                # Test suites
Specs-Driven/         # Spec docs including DEPLOY_AWS.md
docs/                 # data-pipeline.md, design.md, plans
```

## Architecture — tiered read pattern

```
Browser ──► Next.js 16 (Amplify, WEB_COMPUTE)
                │
                ├── Bundled JSON (src/lib/data/cars-ml/)  ← source of truth
                ├── DynamoDB single-table cache           ← hot tier
                └── OldCarsData API                       ← live prices
```

**L0 memory → L1 DynamoDB → L2 bundled JSON → L3 OldCarsData API.** The site must degrade gracefully when DynamoDB or the API key is unavailable — never hard-fail a page render on a cache/API miss.

## Data sources — respect these boundaries

- **OldCarsData** — primary. BaT + Cars & Bids auction results. **The only price source.**
- **CarQuery** — catalog metadata (year/make/model/trim/specs) only. **Never use for prices.**
- **NHTSA** — VIN decode, production totals, recalls.
- **Bring a Trailer** — search URL resolver only (rate-limited).
- **Reddit + Google Trends** — community-demand signal blend, not price.

## Scripts

- `npm run dev` — Next dev server
- `npm run lint` / `verify:lint` — ESLint
- `npm run build` / `verify:build` — Next production build
- `npm run verify:scripts` — sanity-check all sync scripts parse
- `npm run verify` — full chain: lint + build + verify:scripts
- `npm run sync:cars:catalog` — rebuild canonical car catalog (Python)
- `npm run sync:cars:segments` — rebuild `segment-catalog.json`
- `npm run sync:oldcarsdata` — pull live OldCarsData prices (needs API key)
- `npm run train:cars-ml` / `retrain:cars-ml` — retrain XGBoost models
- `npm run build:community` / `build:price:aggregates` / `build:brand` — feature builders
- `npm run ingest:cars:catalog` — bulk ingest with checkpointing
- `npm run sync:bat:history` / `sync:trends` / `sync:images` — auxiliary syncs

**Before pushing:** run `npm run verify`.

## Invariants — do not break

- **Prices come from OldCarsData only.** Do not introduce another price source or fall back to CarQuery.
- **Bundled JSON in `src/lib/data/cars-ml/` is the source of truth.** DynamoDB and OldCarsData are caches/refreshers on top of it.
- **Graceful degradation.** Missing DynamoDB creds or API key must not crash pages.
- **Hide cars without real predictions from search/listings** (see recent commit).
- **Mobile has no horizontal overflow** (regression fixed recently; check on catalog + detail before merge).
- **Signals must round-trip.** Buy/Hold/Sell + confidence tier + projection range come from `src/lib/domain/`, not ad-hoc component logic.
- **ML retraining is a separate pipeline** (see `infra/cars-ml-retrainer`). Do not retrain during a normal request.

## Working style for agents

- **TDD** for behavior changes: add a test under `tests/` first, watch it fail, then implement.
- **Use `edit`** on existing files; `create` only for genuinely new files.
- **Stage explicit paths only.** Never `git add -A` / `git add .`.
- **Every commit ends with this trailer:**

  ```
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  ```

- **Commit style** matches history: `feat(brand): ...`, `fix(tests): ...`, `feat(ml): ...`.
- **Verify before claiming done.** Run `npm run verify` and read the output before saying it passes.
- **Do not commit agent planning markdown.** Long-form plans live in `~/.copilot/session-state/<id>/plan.md`.

## Deployment

See `Specs-Driven/DEPLOY_AWS.md` for the Amplify connect, env-var, DynamoDB provisioning, and (optional) quarterly retrainer Lambda runbook. Do not commit AWS credentials or the OldCarsData API key.

## Autopilot notes

- Primary agent context: this file + `README.md` + `docs/data-pipeline.md` + `docs/design.md` + `Specs-Driven/DEPLOY_AWS.md`.
- If a change touches pricing, ML training, DynamoDB schema, or Amplify config, stop and ask before shipping.
- If a task is ambiguous, prefer the smallest change that preserves invariants, then verify.
