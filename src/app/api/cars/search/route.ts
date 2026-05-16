import { NextResponse, type NextRequest } from "next/server";
import { searchCatalog } from "@/lib/db/car-search";
import { coerceSegment } from "@/lib/domain/car-catalog-search";
import { hydrateForecast } from "@/lib/domain/car-forecast";
import { ok, fail } from "@/lib/api/envelope";
import { ERROR_CODES, apiError } from "@/lib/errors";
import { loggerFor } from "@/lib/logger";

export const runtime = "nodejs";

const log = loggerFor("api.cars.search");

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";
    const segmentParam = searchParams.get("segment");
    const recommendation = searchParams.get("recommendation");
    const offset = parseIntParam(searchParams.get("offset"), 0);
    const limit = Math.min(
      Math.max(parseIntParam(searchParams.get("limit"), DEFAULT_LIMIT), 1),
      MAX_LIMIT,
    );

    // Cheap filters first — operate on un-hydrated rows so we only
    // pay the forecast cost for the slice we actually return.
    let filtered = searchCatalog(q);

    if (segmentParam) {
      const seg = coerceSegment(segmentParam) ?? segmentParam;
      filtered = filtered.filter((c) => c.segment === seg);
    }

    // Recommendation filter requires forecast. If active, hydrate first,
    // then filter; otherwise defer hydration to the slice.
    let total: number;
    let slice: typeof filtered;
    if (recommendation && recommendation !== "all") {
      const hydrated = filtered.map(hydrateForecast).filter(
        (c) => c.forecast?.recommendation === recommendation,
      );
      total = hydrated.length;
      slice = hydrated.slice(offset, offset + limit);
    } else {
      total = filtered.length;
      slice = filtered.slice(offset, offset + limit).map(hydrateForecast);
    }

    return ok({
      results: slice,
      count: slice.length,
      total,
      offset,
      limit,
    });
  } catch (err) {
    log.error({ err: String(err) }, "search failed");
    return fail(apiError(ERROR_CODES.E001_CAR_SEARCH_FAILED, "Catalog search failed."), 500);
  }
}

void NextResponse;
