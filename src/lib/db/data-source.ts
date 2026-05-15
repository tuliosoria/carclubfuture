/**
 * Tiered cache pattern (Day 1 bake-in §18.1.1).
 *
 *   request → L0 in-memory → L1 DynamoDB → L2 bundled JSON → L3 origin
 *
 * Each tier implements `get` and (where writable) `set`. DataSource composes
 * them and gives every feature one place to reason about freshness.
 */
import { loggerFor } from "@/lib/logger";

const log = loggerFor("data-source");

export interface CacheTier<T> {
  name: string;
  ttlMs: number | null; // null = never expires (e.g. bundled fallback)
  get(key: string): Promise<T | null>;
  set?(key: string, value: T): Promise<void>;
}

export interface DataSourceOptions<T> {
  feature: string;
  tiers: CacheTier<T>[];
  origin?: (key: string) => Promise<T | null>;
}

export class DataSource<T> {
  constructor(private readonly opts: DataSourceOptions<T>) {}

  async get(key: string): Promise<T | null> {
    for (const tier of this.opts.tiers) {
      try {
        const hit = await tier.get(key);
        if (hit !== null && hit !== undefined) {
          log.debug({ feature: this.opts.feature, tier: tier.name, key }, "cache hit");
          return hit;
        }
      } catch (err) {
        log.warn({ feature: this.opts.feature, tier: tier.name, err: String(err) }, "tier read failed");
      }
    }
    if (!this.opts.origin) return null;
    log.debug({ feature: this.opts.feature, key }, "origin miss-through");
    const fresh = await this.opts.origin(key);
    if (fresh !== null && fresh !== undefined) {
      // Backfill writable tiers (don't await failures; best-effort).
      for (const tier of this.opts.tiers) {
        if (tier.set) {
          tier.set(key, fresh).catch((err) =>
            log.warn({ feature: this.opts.feature, tier: tier.name, err: String(err) }, "tier write failed")
          );
        }
      }
    }
    return fresh;
  }
}

/** Process-local TTL cache. Useful as L0 in front of every DataSource. */
export function memoryTier<T>(ttlMs: number, name = "memory"): CacheTier<T> {
  const store = new Map<string, { value: T; expiresAt: number }>();
  return {
    name,
    ttlMs,
    async get(key) {
      const hit = store.get(key);
      if (!hit) return null;
      if (hit.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    async set(key, value) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
  };
}
