# CarClubFuture — Phased Build Log

This document tracks completed work against the rebuild plan in
`RECREATE.md`. Phases are independently verifiable; each one ends with
a clean `npm run verify` (lint + build + script syntax).

- [x] **Phase 0** — bootstrap: gitignore, package.json, deps, ESLint,
      TS, pre-push hook
- [x] **Phase 1** — app shell, layout, landing, legal pages, `/api/health`,
      string utils, pino logger
- [x] **Phase 2** — catalog data plumbing: types, segments, seed JSON
      (12 vehicles / 3 segments), DataSource tiered cache
- [x] **Phase 3** — `/car-forecast` catalog + sticky filter sidebar
      (Segment / Era / Body / Recommendation / Scenario / Sort)
- [x] **Phase 4** — 8 cars APIs, forecast/recommendation/confidence
      logic, BaT link resolver, error-code envelope, `runtime="nodejs"`
- [x] **Phase 5** — `/car-forecast/[slug]` detail page, methodology
- [x] **Phase 6** — `/market-index` (7 segment cards + Market Rating)
- [x] **Phase 7** — `/calculator` (Restoration / Flip / Hold tabs)
- [x] **Phase 8** — sync pipelines (catalog, oldcarsdata, trends, segments,
      community score, image mirror, BaT link validator)
- [x] **Phase 9** — XGBoost training scripts + runtime model loader with
      `CARS_ML_MODEL_SOURCE=auto|bundled`
- [x] **Phase 10** — `amplify.yml`, `setup-dynamodb.sh`, retrainer
      Dockerfile + SAM template, `DEPLOY_AWS.md` runbook
- [x] **Phase 11** — first-visit disclaimer, a11y pass, README
