import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/envelope";
import { ERROR_CODES, apiError } from "@/lib/errors";
import { loggerFor } from "@/lib/logger";

export const runtime = "nodejs";

const log = loggerFor("api.cars.vin");
const NHTSA_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const vin = searchParams.get("vin")?.trim();
  if (!vin || vin.length !== 17) {
    return fail(apiError(ERROR_CODES.E008_INVALID_REQUEST, "VIN must be 17 characters."), 400);
  }
  try {
    const r = await fetch(`${NHTSA_BASE}/${encodeURIComponent(vin)}?format=json`, {
      headers: { "User-Agent": "CarClubFuture/1.0 (+https://carclubfuture.com)" },
      next: { revalidate: 86400 },
    });
    if (!r.ok) throw new Error(`NHTSA ${r.status}`);
    const json = (await r.json()) as { Results?: Record<string, unknown>[] };
    const row = json.Results?.[0] ?? {};
    return ok({ vin, decoded: row });
  } catch (err) {
    log.error({ err: String(err), vin }, "VIN decode failed");
    return fail(apiError(ERROR_CODES.E006_VIN_DECODE_FAILED, "VIN decode failed upstream."), 502);
  }
}
