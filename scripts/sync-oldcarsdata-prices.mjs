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
const ENDPOINT = process.env.OLDCARSDATA_BASE_URL ?? "https://api.oldcarsdata.com/v1";
const UA = "CarClubFuture/1.0 (+https://carclubfuture.com)";

const limiter = new RateLimiter(2);

async function fetchSnapshot(apiKey, year, make, model) {
  await limiter.take();
  const url =
    `${ENDPOINT}/vehicles/snapshot?year=${year}` +
    `&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`;
  const r = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": UA },
  });
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, body: await r.json() };
}

function snapshotToPriceRow(snap) {
  // OldCarsData free tier returns shape like:
  //   { sales: [{soldPrice, mileage, reserveMet, soldAt}, ...], stats:{ median, count, reserveMetPct } }
  // We defensively pluck both shapes.
  const stats = snap?.stats ?? {};
  const median =
    Number(stats.median ?? stats.medianSoldPrice ?? snap?.medianSoldPrice ?? snap?.value) || null;
  const count = Number(stats.count ?? snap?.count ?? snap?.sales?.length ?? 0);
  const reserveMet =
    typeof stats.reserveMetPct === "number"
      ? stats.reserveMetPct
      : typeof stats.reserveMetRate === "number"
      ? stats.reserveMetRate
      : null;
  if (!median) return null;
  return {
    asOf: new Date().toISOString(),
    conditionAnchor: 3,
    valueUsd: median,
    auctionMedian12moUsd: median,
    auctionCount12mo: count,
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
  const prices = {};
  let dynamoWrites = 0;

  await timed("sync:oldcarsdata", async () => {
    let ok = 0, failed = 0;
    for (const c of cars) {
      try {
        const result = await fetchSnapshot(apiKey, c.year, c.make, c.model);
        if (!result.ok) {
          failed++;
          jsonLog({ operation: "oldcarsdata.miss", slug: c.slug, status: result.status });
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
