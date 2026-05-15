import { NextResponse, type NextRequest } from "next/server";
import { searchCatalog } from "@/lib/db/car-search";
import { coerceSegment } from "@/lib/domain/car-catalog-search";
import { hydrateForecast } from "@/lib/domain/car-forecast";
import { ok, fail } from "@/lib/api/envelope";
import { ERROR_CODES, apiError } from "@/lib/errors";
import { loggerFor } from "@/lib/logger";

export const runtime = "nodejs";

const log = loggerFor("api.cars.search");

export function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";
    const segmentParam = searchParams.get("segment");
    const recommendation = searchParams.get("recommendation");

    let results = searchCatalog(q).map(hydrateForecast);

    if (segmentParam) {
      const seg = coerceSegment(segmentParam) ?? segmentParam;
      results = results.filter((c) => c.segment === seg);
    }
    if (recommendation && recommendation !== "all") {
      results = results.filter((c) => c.forecast?.recommendation === recommendation);
    }
    return ok({ results, count: results.length });
  } catch (err) {
    log.error({ err: String(err) }, "search failed");
    return fail(apiError(ERROR_CODES.E001_CAR_SEARCH_FAILED, "Catalog search failed."), 500);
  }
}

void NextResponse;
