/**
 * Tiered read-only cache for Next.js server components.
 *
 * Layers (read path only — no origin write-back at request time):
 *   L0  In-process Map — fastest, lost on process exit.
 *   L1  DynamoDB — survives restarts, TTL-managed.
 *   L2  Bundled JSON fallback — ships in the Next.js server bundle.
 *   MISS — all layers exhausted.
 *
 * Key conventions (must match the sync jobs):
 *   Auctions: pk=`oldcarsdata#<slug>`, sk="v1"
 *   Images:   pk=`image#<slug>`,        sk="v1"
 */
import "server-only";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { PriceSnapshot } from "@/lib/types/cars";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface CachedAuction {
  value: PriceSnapshot | null;
  layer: "L0" | "L1" | "L2" | "L3" | "MISS";
  source: "oldcarsdata" | "bundled" | "estimate" | "miss";
}

export interface CachedImage {
  url: string;
  width: number | null;
  attribution: { author: string; license: string; licenseUrl: string };
  layer: "L1" | "L2" | "MISS";
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface L0Entry {
  value: unknown;
  expiresAt: number; // epoch ms
}

interface DdbItem {
  pk: string;
  sk: string;
  payload: unknown;
  cachedAt: string;
  expiresAt: number; // epoch seconds
  source?: string;
}

interface BundledImageRecord {
  url: string;
  width?: number;
  license?: string;
  author?: string;
  licenseUrl?: string;
  sourcePageUrl?: string;
}

interface BundledPricesJson {
  generatedAt: string;
  prices: Record<string, PriceSnapshot>;
}

// ---------------------------------------------------------------------------
// DynamoDB — lazy module-level singleton
// ---------------------------------------------------------------------------

let _ddbClient: DynamoDBDocumentClient | null = null;

function getDdbClient(): DynamoDBDocumentClient {
  if (!_ddbClient) {
    _ddbClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
      { marshallOptions: { removeUndefinedValues: true } },
    );
  }
  return _ddbClient;
}

// ---------------------------------------------------------------------------
// L0: in-process memory cache
// Key: "${pk}\x00${sk}" — null-byte separator avoids collisions.
// ---------------------------------------------------------------------------

const _l0Cache = new Map<string, L0Entry>();

function l0Get(pk: string, sk: string): unknown {
  const entry = _l0Cache.get(`${pk}\x00${sk}`);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  return undefined;
}

function l0Set(pk: string, sk: string, value: unknown, expiresAtMs: number): void {
  _l0Cache.set(`${pk}\x00${sk}`, { value, expiresAt: expiresAtMs });
}

/** Clear in-process cache. Intended for tests only. */
export function clearMemoryCache(): void {
  _l0Cache.clear();
}

// ---------------------------------------------------------------------------
// L1: DynamoDB read
// Returns the item only when it exists and has not expired.
// Strict > check (not >=) matching the JS helper.
// ---------------------------------------------------------------------------

async function l1Get(pk: string, sk: string, tableName: string): Promise<DdbItem | null> {
  const result = await getDdbClient().send(
    new GetCommand({ TableName: tableName, Key: { pk, sk } }),
  );
  const item = result.Item as DdbItem | undefined;
  if (item && item.expiresAt * 1000 > Date.now()) return item;
  return null;
}

// ---------------------------------------------------------------------------
// L2: bundled JSON fallback — loaded once per process and cached at module scope
// ---------------------------------------------------------------------------

let _bundledPrices: Record<string, PriceSnapshot> | null = null;
let _bundledImages: Record<string, BundledImageRecord> | null = null;

async function getBundledPrices(): Promise<Record<string, PriceSnapshot>> {
  if (_bundledPrices) return _bundledPrices;
  const mod = (await import(
    "@/lib/data/cars-ml/oldcarsdata-current-prices.json"
  )) as unknown as { default: BundledPricesJson };
  _bundledPrices = mod.default.prices;
  return _bundledPrices;
}

async function getBundledImages(): Promise<Record<string, BundledImageRecord>> {
  if (_bundledImages) return _bundledImages;
  const mod = (await import(
    "@/lib/data/cars-ml/oldcarsdata-auction-images.json"
  )) as { default: Record<string, BundledImageRecord> };
  _bundledImages = mod.default;
  return _bundledImages;
}

// ---------------------------------------------------------------------------
// Table name — resolved once at module load
// ---------------------------------------------------------------------------

const TABLE = process.env.DYNAMODB_TABLE ?? "carclubfuture-cache";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read-only auction-snapshot lookup with tiered fallback (L0 → L1 → L2).
 * Never calls OldCarsData at request time — that's a sync-job concern.
 * On full miss returns { value: null, layer: "MISS", source: "miss" }.
 */
export async function getCachedAuction(slug: string): Promise<CachedAuction> {
  const pk = `oldcarsdata#${slug}`;
  const sk = "v1";

  // L0: in-process
  const l0 = l0Get(pk, sk);
  if (l0 !== undefined) {
    return { value: l0 as PriceSnapshot, layer: "L0", source: "oldcarsdata" };
  }

  // L1: DynamoDB
  try {
    const item = await l1Get(pk, sk, TABLE);
    if (item) {
      l0Set(pk, sk, item.payload, item.expiresAt * 1000);
      return {
        value: item.payload as PriceSnapshot,
        layer: "L1",
        source: (item.source as CachedAuction["source"]) ?? "oldcarsdata",
      };
    }
  } catch (err) {
    console.error("[cache] getCachedAuction L1 error", slug, err);
  }

  // L2: bundled JSON
  try {
    const prices = await getBundledPrices();
    const snapshot = prices[slug];
    if (snapshot != null) {
      return { value: snapshot, layer: "L2", source: "bundled" };
    }
  } catch (err) {
    console.error("[cache] getCachedAuction L2 error", slug, err);
  }

  return { value: null, layer: "MISS", source: "miss" };
}

/**
 * Best-effort lookup for an image record.
 * Same semantics: read-only, never fetches Wikimedia at request time.
 * Returns null on full miss.
 */
export async function getCachedImage(slug: string): Promise<CachedImage | null> {
  const pk = `image#${slug}`;
  const sk = "v1";

  // L1: DynamoDB
  try {
    const item = await l1Get(pk, sk, TABLE);
    if (item) {
      const r = item.payload as BundledImageRecord;
      return {
        url: r.url,
        width: r.width ?? null,
        attribution: {
          author: r.author ?? "",
          license: r.license ?? "",
          licenseUrl: r.licenseUrl ?? r.sourcePageUrl ?? "",
        },
        layer: "L1",
      };
    }
  } catch (err) {
    console.error("[cache] getCachedImage L1 error", slug, err);
  }

  // L2: bundled JSON
  try {
    const images = await getBundledImages();
    const r = images[slug];
    if (r != null) {
      return {
        url: r.url,
        width: r.width ?? null,
        attribution: {
          author: r.author ?? "",
          license: r.license ?? "",
          licenseUrl: r.licenseUrl ?? r.sourcePageUrl ?? "",
        },
        layer: "L2",
      };
    }
  } catch (err) {
    console.error("[cache] getCachedImage L2 error", slug, err);
  }

  return null;
}
