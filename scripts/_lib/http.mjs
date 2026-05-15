/**
 * Shared HTTP / log / atomic-write helpers for sync scripts.
 *
 * - `fetchWithRetry(url, init, opts)` — 3 attempts, exponential backoff
 *   (200/400/800ms) with ±25% jitter. Retries on network errors and on
 *   HTTP 429/5xx. Returns the final Response (caller checks `.ok`).
 * - `RateLimiter(rps)` — simple token-bucket. `await rl.take()` before
 *   each external call.
 * - `writeJsonAtomic(path, data)` — writes to `<path>.tmp`, fsyncs, then
 *   renames over `path`. Atomic on POSIX (same filesystem).
 * - `jsonLog(payload)` — structured log line to stdout. All fields:
 *   `{ts, operation, durationMs, recordsProcessed, ok, failed, error}`.
 */
import { writeFile, rename, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_RETRY_DELAYS_MS = [200, 400, 800];

function jitter(base) {
  const spread = base * 0.25;
  return base + (Math.random() * 2 - 1) * spread;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with exponential backoff + jitter. Retries on network errors and
 * on HTTP 429/5xx. On final failure returns the last Response (so callers
 * can read body for diagnostics) or throws if no Response was ever obtained.
 */
export async function fetchWithRetry(url, init = {}, opts = {}) {
  const delays = opts.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const attempts = delays.length + 1;
  let lastErr;
  let lastResp;
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(url, init);
      lastResp = resp;
      if (resp.ok) return resp;
      if (resp.status !== 429 && resp.status < 500) return resp; // 4xx not worth retrying
    } catch (err) {
      lastErr = err;
    }
    if (i < delays.length) await sleep(jitter(delays[i]));
  }
  if (lastResp) return lastResp;
  throw lastErr ?? new Error(`fetchWithRetry failed: ${url}`);
}

/** Token-bucket rate limiter, `rps` requests per second. */
export class RateLimiter {
  constructor(rps) {
    this.intervalMs = 1000 / Math.max(0.1, rps);
    this.next = 0;
  }
  async take() {
    const now = Date.now();
    const wait = Math.max(0, this.next - now);
    this.next = Math.max(now, this.next) + this.intervalMs;
    if (wait > 0) await sleep(wait);
  }
}

/** Atomic JSON write: tmp → fsync → rename. */
export async function writeJsonAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const body = JSON.stringify(data, null, 2) + "\n";
  await writeFile(tmp, body, "utf8");
  // fsync to flush to disk
  const fh = await open(tmp, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, path);
}

/** Structured JSON log line to stdout. */
export function jsonLog(payload) {
  const line = {
    ts: new Date().toISOString(),
    ...payload,
    ...(payload.error
      ? { error: payload.error instanceof Error ? payload.error.message : String(payload.error) }
      : {}),
  };
  process.stdout.write(JSON.stringify(line) + "\n");
}

/** Helper for timing an operation and emitting one log line at the end. */
export async function timed(operation, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    jsonLog({
      operation,
      durationMs: Date.now() - start,
      recordsProcessed: result?.recordsProcessed ?? 0,
      ok: result?.ok ?? 0,
      failed: result?.failed ?? 0,
    });
    return result;
  } catch (error) {
    jsonLog({ operation, durationMs: Date.now() - start, error });
    throw error;
  }
}
