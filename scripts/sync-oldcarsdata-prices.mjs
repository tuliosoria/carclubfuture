#!/usr/bin/env node
/**
 * sync-oldcarsdata-prices.mjs
 *
 * Pulls live OldCarsData auction snapshots for every catalog vehicle and
 * writes them in PriceRow shape (see src/lib/db/car-search.ts) to
 * src/lib/data/cars-ml/oldcarsdata-current-prices.json. Optionally
 * mirrors each row into DynamoDB under pk=oldcarsdata#<slug>, sk=v1.
 *
 * Free tier returns last 14 days only — sparse data is expected; the
 * baseline forecast model continues to work as a fallback.
 *
 * Hardening: 3-retry exponential backoff, 2 req/s rate limit, atomic
 * write of the output JSON, structured stdout logs.
 *
 * Requires OLDCARSDATA_API_KEY. No-ops with exit 0 if missing.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { fetchWithRetry, RateLimiter, writeJsonAtomic, jsonLog, timed } from "./_lib/http.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "src/lib/data/cars-ml/cars-catalog.json");
const OUT = resolve(ROOT, "src/lib/data/cars-ml/oldcarsdata-current-prices.json");
const ENDPOINT = process.env.OLDCARSDATA_BASE_URL ?? "https://api.oldcarsdata.com";
const UA = "CarClubFuture/1.0 (+https://carclubfuture.com)";

const limiter = new RateLimiter(0.5);
const SLOW_RETRY = { delaysMs: [2000, 6000, 15000] };

async function fetchSnapshot(apiKey, year, make, model) {
  await limiter.take();
  const params = new URLSearchParams({
    make,
    model,
    year_min: String(year),
    year_max: String(year),
    status: "sold",
    limit: "100",
  });
  const url = `${ENDPOINT}/auctions?${params.toString()}`;
  const r = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": UA },
  }, SLOW_RETRY);
  const remaining = Number(r.headers.get("x-ratelimit-remaining"));
  const reset = r.headers.get("x-ratelimit-reset");
  if (!r.ok) return { ok: false, status: r.status, remaining, reset };
  return { ok: true, body: await r.json(), remaining, reset };
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function snapshotToPriceRow(snap) {
  const sales = Array.isArray(snap?.data) ? snap.data : Array.isArray(snap?.sales) ? snap.sales : [];
  const prices = sales
    .map((s) => Number(s.price ?? s.soldPrice))
    .filter((n) => Number.isFinite(n) && n > 0);
  const med = median(prices);
  if (med == null) return null;
  const reservedSales = sales.filter((s) => s.has_reserve === true || s.reserve === true);
  const reserveMet = reservedSales.length
    ? reservedSales.filter((s) => (s.auction_status ?? s.status) === "sold").length /
      reservedSales.length
    : null;
  return {
    asOf: new Date().toISOString(),
    conditionAnchor: 3,
    valueUsd: Math.round(med),
    auctionMedian12moUsd: Math.round(med),
    auctionCount12mo: prices.length,
    reserveMetRate12mo: reserveMet,
  };
}

async function maybePutDynamo(slug, row) {
  // Optional DynamoDB mirror — only if AWS region + table are configured.
  const tableName = process.env.DYNAMODB_TABLE;
  if (!tableName || !process.env.AWS_REGION) return false;
  try {
    const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, PutCommand } = await import("@aws-sdk/lib-dynamodb");
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: `oldcarsdata#${slug}`,
          sk: "v1",
          body: JSON.stringify(row),
          updatedAt: row.asOf,
        },
      })
    );
    return true;
  } catch (err) {
    jsonLog({ operation: "dynamo.put.error", slug, error: err });
    return false;
  }
}

async function main() {
  const apiKey = process.env.OLDCARSDATA_API_KEY;
  if (!apiKey) {
    jsonLog({ operation: "oldcarsdata.skip", reason: "OLDCARSDATA_API_KEY missing" });
    return;
  }

  const catalogFile = JSON.parse(await readFile(CATALOG, "utf8"));
  const cars = Array.isArray(catalogFile) ? catalogFile : catalogFile.vehicles ?? [];

  /** @type {Record<string, ReturnType<typeof snapshotToPriceRow>>} */
  let prices = {};
  try {
    const existing = JSON.parse(await readFile(OUT, "utf8"));
    if (existing?.prices) prices = existing.prices;
  } catch { /* fresh run */ }
  let dynamoWrites = 0;

  await timed("sync:oldcarsdata", async () => {
    let ok = 0, failed = 0;
    for (const c of cars) {
      try {
        const result = await fetchSnapshot(apiKey, c.year, c.make, c.model);
        if (!result.ok) {
          failed++;
          jsonLog({ operation: "oldcarsdata.miss", slug: c.slug, status: result.status, remaining: result.remaining });
          // Free tier = 10 req/month. Once quota is gone, stop early to avoid
          // burning successive 429s for hours.
          if (result.status === 429 && result.remaining === 0) {
            jsonLog({ operation: "oldcarsdata.quota_exhausted", reset: result.reset });
            break;
          }
          continue;
        }
        const row = snapshotToPriceRow(result.body);
        if (!row) { failed++; continue; }
        prices[c.slug] = row;
        ok++;
        if (await maybePutDynamo(c.slug, row)) dynamoWrites++;
      } catch (err) {
        failed++;
        jsonLog({ operation: "oldcarsdata.error", slug: c.slug, error: err });
      }
    }
    return { recordsProcessed: cars.length, ok, failed };
  });

  await writeJsonAtomic(OUT, { generatedAt: new Date().toISOString(), prices });
  jsonLog({ operation: "oldcarsdata.persisted", count: Object.keys(prices).length, dynamoWrites });
}

main().catch((err) => {
  jsonLog({ operation: "oldcarsdata.fatal", error: err });
  process.exit(1);
});
