import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/envelope";
import { ERROR_CODES, apiError } from "@/lib/errors";
import { loggerFor } from "@/lib/logger";
import { TokenBucket, fetchWithRetry } from "@/lib/server/upstream-fetch";

export const runtime = "nodejs";

const log = loggerFor("api.cars.vin");
const NHTSA_BASE = "https://vpic.nhtsa.dot.gov/api";
const UA = "CarClubFuture/1.0 (+https://carclubfuture.com)";

// 1 req/s ceiling per Lambda instance — conservative; NHTSA publishes no SLA.
const limiter = new TokenBucket(1);

async function decodeVin(vin: string) {
  await limiter.take();
  const url = `${NHTSA_BASE}/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`;
  const r = await fetchWithRetry(url, {
    headers: { "User-Agent": UA },
    next: { revalidate: 86400 },
  });
  if (!r.ok) throw new Error(`NHTSA decode ${r.status}`);
  const json = (await r.json()) as { Results?: Record<string, unknown>[] };
  return json.Results?.[0] ?? {};
}

async function recallsFor(make: string, model: string, year: number) {
  await limiter.take();
  const url =
    `${NHTSA_BASE}/recalls/recallsByVehicle?make=${encodeURIComponent(make)}` +
    `&model=${encodeURIComponent(model)}&modelYear=${year}`;
  const r = await fetchWithRetry(url, {
    headers: { "User-Agent": UA },
    next: { revalidate: 86400 },
  });
  if (!r.ok) throw new Error(`NHTSA recalls ${r.status}`);
  const json = (await r.json()) as { results?: Record<string, unknown>[]; Count?: number };
  return { count: json.Count ?? json.results?.length ?? 0, results: json.results ?? [] };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const recallsMode = searchParams.get("recalls") === "1";

  if (recallsMode) {
    const make = searchParams.get("make")?.trim();
    const model = searchParams.get("model")?.trim();
    const yearStr = searchParams.get("year")?.trim();
    const year = yearStr ? Number(yearStr) : NaN;
    if (!make || !model || !Number.isInteger(year) || year < 1900 || year > 2100) {
      return fail(
        apiError(
          ERROR_CODES.E008_INVALID_REQUEST,
          "recalls mode requires make, model, and year (1900–2100)."
        ),
        400
      );
    }
    try {
      const recalls = await recallsFor(make, model, year);
      return ok({ make, model, year, ...recalls });
    } catch (err) {
      log.error({ err: String(err), make, model, year }, "NHTSA recalls failed");
      return fail(
        apiError(ERROR_CODES.E006_VIN_DECODE_FAILED, "NHTSA recalls upstream failed."),
        502
      );
    }
  }

  const vin = searchParams.get("vin")?.trim();
  if (!vin || vin.length !== 17) {
    return fail(apiError(ERROR_CODES.E008_INVALID_REQUEST, "VIN must be 17 characters."), 400);
  }
  try {
    const decoded = await decodeVin(vin);
    return ok({ vin, decoded });
  } catch (err) {
    log.error({ err: String(err), vin }, "VIN decode failed");
    return fail(
      apiError(ERROR_CODES.E006_VIN_DECODE_FAILED, "VIN decode failed upstream."),
      502
    );
  }
}
