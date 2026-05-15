# Deploying CarClubFuture to AWS Amplify

## 1. Connect the repository

1. In the AWS Amplify console choose **Host web app → GitHub** and select
   `tuliosoria/carclubfuture` on branch `main`.
2. Confirm the build spec — Amplify will pick up `amplify.yml` automatically.
3. Choose the **WEB_COMPUTE** platform (Next.js 16 SSR).

## 2. Configure environment variables

In the Amplify app's **App settings → Environment variables**, set:

| Key | Required | Notes |
| --- | --- | --- |
| `AWS_REGION` | yes | `us-east-1` or chosen region |
| `DYNAMODB_TABLE` | yes | `carclubfuture-cache` (default) |
| `OLDCARSDATA_API_KEY` | sync only | live auction prices |
| `CARS_ML_MODEL_SOURCE` | optional | `auto` (default) or `bundled` rollback |
| `LEGAL_OPERATOR_NAME` | yes | shown on legal pages |
| `LEGAL_CONTACT_EMAIL` | yes | contact form recipient |
| `LEGAL_BUSINESS_ADDRESS` | yes | shown on Privacy/Terms |
| `PRIVACY_REQUEST_EMAIL` | yes | privacy-rights inbox |
| `LEGAL_CONTACT_URL` | optional | external contact form (overrides default) |
| `OWNED_DATA_ASSET_BUCKET` | optional | S3 bucket for owned-data exports |
| `OWNED_DATA_ASSET_PREFIX` | optional | default `owned-data` |

If you add a new key, also add it to the `for key in \ … ; do` loop in
`amplify.yml`'s `preBuild` so Next.js sees it at build time.

## 3. Provision DynamoDB

```bash
AWS_REGION=us-east-1 DYNAMODB_TABLE=carclubfuture-cache scripts/setup-dynamodb.sh
```

The Amplify service role must have `dynamodb:GetItem`, `PutItem`,
`Query`, and `BatchGet*` on the table.

## 4. Custom domain

In **App settings → Domain management** add the production domain and let
Amplify manage the certificate. Custom domains are wired through Amplify
(not Route 53 directly) so SSL renewals stay automatic.

## 5. (Optional) Quarterly retrainer Lambda

```bash
cd infra/cars-ml-retrainer
sam build && sam deploy --guided
```

The retrainer reads the latest auction snapshots, retrains XGBoost, and
publishes new model chunks to DynamoDB under
`pk = model#cars-ml#model-{1,3,5}yr`. The runtime loader picks them up
automatically when `CARS_ML_MODEL_SOURCE=auto`.

## 6. Roll back a bad model

Set `CARS_ML_MODEL_SOURCE=bundled` in Amplify and trigger a redeploy. The
runtime will ignore DynamoDB chunks and use the JSON committed in
`src/lib/data/cars-ml/model-*yr.baseline.json` instead.

## 7. Verifying the deploy

After the first build:

- `/api/health` → `{"ok": true}`
- `/car-forecast` lists the 12 seed vehicles with Buy/Hold/Sell signals
- `/market-index` shows 7 segment cards + Market Rating gauge
- `/calculator` opens with the Restoration tab pre-selected
