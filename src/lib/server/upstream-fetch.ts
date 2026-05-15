/**
 * Server-side fetch with retries (3 attempts, exp backoff + jitter) and
 * a per-instance token-bucket rate limiter. Used by Next.js route handlers
 * that proxy to upstream APIs (NHTSA, etc).
 *
 * Note: rate-limit state is per-Lambda / per-process. In multi-instance
 * deploys (Amplify Compute) the effective ceiling is `rps × instances`,
 * which is fine for the conservative 1 rps target used by NHTSA.
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const jitter = (base: number) => base + (Math.random() * 2 - 1) * base * 0.25;

const DELAYS = [200, 400, 800] as const;

export async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastErr: unknown;
  let lastResp: Response | undefined;
  for (let i = 0; i <= DELAYS.length; i++) {
    try {
      const resp = await fetch(input, init);
      lastResp = resp;
      if (resp.ok) return resp;
      if (resp.status !== 429 && resp.status < 500) return resp;
    } catch (err) {
      lastErr = err;
    }
    if (i < DELAYS.length) await sleep(jitter(DELAYS[i]));
  }
  if (lastResp) return lastResp;
  throw lastErr ?? new Error("fetchWithRetry: no response");
}

export class TokenBucket {
  private next = 0;
  constructor(private readonly rps: number) {}
  async take(): Promise<void> {
    const interval = 1000 / Math.max(0.1, this.rps);
    const now = Date.now();
    const wait = Math.max(0, this.next - now);
    this.next = Math.max(now, this.next) + interval;
    if (wait > 0) await sleep(wait);
  }
}
