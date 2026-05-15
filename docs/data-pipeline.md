# CarClubFuture Data Pipeline

## Overview

The CarClubFuture data pipeline fetches, normalises, and caches automotive content
from several external sources (OldCarsData, Wikimedia, Reddit, Bring-a-Trailer) into
a single DynamoDB table that the Next.js front-end reads at request time. All data is
stored under a single-table design with a composite key (`pk` / `sk`) so that
different entity types share one provisioned table while remaining easy to scan and
expire via DynamoDB TTL.

---

## DynamoDB Schema

### Table

| Property       | Value                    |
| -------------- | ------------------------ |
| **Table name** | `carclubfuture-cache`    |
| **Region**     | `us-east-1` (default; overridable via `AWS_REGION` env var) |
| **Billing**    | `PAY_PER_REQUEST` (on-demand) |

### Keys

| Attribute | Type   | Role           |
| --------- | ------ | -------------- |
| `pk`      | String | Partition key  |
| `sk`      | String | Sort key       |

### `pk` Prefixes

| Prefix pattern                         | Entity                                  |
| -------------------------------------- | --------------------------------------- |
| `oldcarsdata#<slug>`                   | OldCarsData vehicle page cache          |
| `community#<slug>`                     | Community / club page                   |
| `image#<slug>`                         | Wikimedia image metadata                |
| `bat-history#<slug>#<yyyymm>`          | Bring-a-Trailer auction history (monthly) |
| `macro#<key>`                          | Macro / market-level data (e.g. indices)|

### `sk` Values

| Value      | Meaning                                   |
| ---------- | ----------------------------------------- |
| `v1`       | Singleton record (current snapshot)       |
| `<yyyymm>` | Monthly snapshot (e.g. `202504`)          |

### Non-key Attributes

| Attribute   | Type   | Description                                                        |
| ----------- | ------ | ------------------------------------------------------------------ |
| `payload`   | Map    | The cached JSON object (structure varies by entity type)           |
| `cachedAt`  | String | ISO 8601 timestamp of when the record was last written             |
| `source`    | String | Origin name: `oldcarsdata`, `wikimedia`, `reddit`, `bat`, etc.     |
| `expiresAt` | Number | Unix epoch seconds — **TTL attribute** (DynamoDB auto-deletes on expiry) |

### TTL

TTL is enabled on the `expiresAt` attribute:

```sh
aws dynamodb update-time-to-live \
  --table-name carclubfuture-cache \
  --region us-east-1 \
  --time-to-live-specification "Enabled=true, AttributeName=expiresAt"
```

This command is idempotent — re-running it when TTL is already enabled returns the
existing configuration without error.

### Provisioning

The table is provisioned by `scripts/setup-dynamodb.sh` (idempotent — safe to
re-run). It checks whether the table already exists before attempting to create it.

---

## Run Order

`npm run sync:full` runs all steps below in order. Optional steps are skipped when their required env var is absent; the run continues.

| Step | Command | Inputs | Outputs | Required Env | Notes |
| --- | --- | --- | --- | --- | --- |
| Catalog | `npm run sync:cars:catalog` | (none) | `cars-catalog.json` | — | Hydrates 12 known slugs from CarQuery + NHTSA |
| Bulk catalog | `npm run ingest:cars:catalog` | (none) | `cars-catalog-bulk.json` | `CARAPI_KEY` (optional) | Resumable; CarQuery + NHTSA + optional CarAPI |
| OldCarsData | `npm run sync:oldcarsdata` | catalog | `oldcarsdata-current-prices.json` | `OLDCARSDATA_API_KEY` | 10 reqs/month free; cached 48h in DynamoDB |
| BaT history | `npm run sync:bat:history` | catalog | `bat-auction-history.json` | `BAT_SCRAPE_ENABLED=1` | Polite 1 req/3s; 30d DynamoDB cache |
| Price aggregates | `npm run build:price:aggregates` | OldCarsData + BaT | `price-aggregates.json` | — | 12mo/36mo medians; flags `data_status` |
| Community | `npm run build:community` | catalog | `community-score.json` | — | Reddit + VADER + Trends + Hemmings; 7d cache |
| Images | `npm run sync:images` | catalog | `oldcarsdata-auction-images.json`, `missing-images.json` | — | Wikimedia → OldCarsData fallback; attribution required |
| Brand features | `npm run build:brand` | price-aggregates | `brand-features.json` | — | Per-make CAGR proxy + tier + volume rank |
| Macro features | `npm run sync:macro` | (none) | `macro-features.json` | — | Stooq CSV — currently captcha-blocked |
| ML training | `npm run train:cars-ml` | all features | `model-1yr.json`, `training-summary.json` | — | Refuses to train if eligible_count < 30 |
| Limitations | `npm run build:limitations` | all outputs | `scripts/output/limitations-report.json` | — | Surfaces all data gaps |
| Full run | `npm run sync:full` | (none) | all of above | varies | Orchestrates above in order |

---

## Environment Variables

See `.env.example` at the repo root for a fully-annotated copy of all variables.

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `OLDCARSDATA_API_KEY` | — | For `sync:oldcarsdata` | OldCarsData API key. Free tier: 10 req/month, last 14 days only. |
| `BAT_SCRAPE_ENABLED` | — | For `sync:bat:history` | Set to `"1"` to enable BaT HTML scraping (polite 1 req/3s). |
| `CARAPI_KEY` | — | Optional | CarAPI key; enriches bulk catalog with trim-level specs. |
| `AWS_REGION` | `us-east-1` | DynamoDB | AWS region for the cache table. |
| `DYNAMODB_TABLE` | `carclubfuture-cache` | DynamoDB | DynamoDB table name. |
| `AWS_ACCESS_KEY_ID` | — | Dev only | Static AWS key (prefer IAM role in production). |
| `AWS_SECRET_ACCESS_KEY` | — | Dev only | Static AWS secret (prefer IAM role in production). |
| `CARQUERY_BASE_URL` | — | Optional | Override CarQuery base URL (testing). |
| `CARS_ML_MODEL_SOURCE` | `auto` | — | ML model source (`auto` \| `local` \| `s3`). |
| `CARS_ML_PUBLISH_ENABLED` | `false` | — | Set `true` to publish trained models to S3. |

---

## Limitations Report

`scripts/build-limitations-report.mjs` (run via `npm run build:limitations`) reads
all pipeline output JSON files and produces a single summary at:

```
scripts/output/limitations-report.json
```

The report is regenerated on every pipeline run and is also printed to stdout at the
end of `npm run sync:full`.

### Schema

```json
{
  "generated_at": "<ISO timestamp>",
  "vehicles": {
    "total_catalog": "<count of slugs in cars-catalog.json>",
    "forecast_eligible": "<count with auction_count_36mo >= 5>",
    "not_forecast_eligible": ["<slug>", "..."],
    "image_missing": ["<slug>", "..."],
    "community_low_confidence": ["<slug with < 10 community data points>", "..."]
  },
  "data_sources": {
    "macro": { "sp500_status": "ok | insufficient", "gold_status": "ok | insufficient" },
    "oldcarsdata": { "calls_this_run": null, "free_tier_remaining": null },
    "bat": { "scrape_enabled": false, "slugs_scraped": 0 }
  },
  "ml": {
    "status": "<from training-summary.json>",
    "trained_horizons": [],
    "untrained_horizons": [{ "horizon": "1yr", "reason": "insufficient_eligible_rows" }]
  },
  "api_errors": [],
  "open_questions": ["<known limitation strings>"]
}
```

### Acting on the report

| Field | Action |
| --- | --- |
| `not_forecast_eligible` non-empty | Add BaT / OldCarsData history for those slugs; or expand the catalog. |
| `image_missing` non-empty | Run `npm run sync:images` or add manual image overrides. |
| `community_low_confidence` non-empty | Low-traffic vehicles; community score is unreliable. |
| `macro.sp500_status: "insufficient"` | Stooq is captcha-blocked — configure FRED, Yahoo, or Twelve Data. |
| `ml.trained_horizons` empty | Need 30+ forecast-eligible vehicles before XGBoost training runs. |

---

## Known Gaps (current state)

- **12 vehicles in catalog** — need 30+ with `auction_count_36mo >= 5` before XGBoost training is meaningful.
- **OldCarsData free tier** — 10 requests/month maximum; endpoint returns last 14 days of auctions only. 12mo/36mo aggregates cannot be populated without a paid tier.
- **Stooq macro source captcha-blocked** — `macro-features.json` currently has `data_status: "insufficient"`. A FRED, Yahoo Finance, or Twelve Data integration is needed to unblock macro features.
- **BaT scrape off by default** — set `BAT_SCRAPE_ENABLED=1` to enable. Without it `bat-auction-history.json` is empty and price aggregates rely solely on OldCarsData.
- **3yr / 5yr ML horizons require historical price snapshots** — these are not yet stored. Until a time-series snapshot job is added, 3yr and 5yr models cannot train.
