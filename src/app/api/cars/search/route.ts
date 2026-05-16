import { NextResponse, type NextRequest } from "next/server";
import { searchCatalog } from "@/lib/db/car-search";
import { coerceSegment } from "@/lib/domain/car-catalog-search";
import { hydrateForecast } from "@/lib/domain/car-forecast";
import { ok, fail } from "@/lib/api/envelope";
import { ERROR_CODES, apiError } from "@/lib/errors";
import { loggerFor } from "@/lib/logger";
import type { BodyStyle, Segment } from "@/lib/types/cars";

export const runtime = "nodejs";

const log = loggerFor("api.cars.search");

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function decadeOf(year: number): string {
  return `${Math.floor(year / 10) * 10}s`;
}

export function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";
    const segmentParam = searchParams.get("segment");
    const eraParam = searchParams.get("era");
    const bodyParam = searchParams.get("body");
    const decadeParam = searchParams.get("decade");
    const recommendation = searchParams.get("recommendation");
    const offset = parseIntParam(searchParams.get("offset"), 0);
    const limit = Math.min(
      Math.max(parseIntParam(searchParams.get("limit"), DEFAULT_LIMIT), 1),
      MAX_LIMIT,
    );

    // Step 1: cheap filter by free-text query.
    const queryFiltered = searchCatalog(q);

    // Step 2: compute facets BEFORE applying the structured filters, so each
    // facet shows global counts that would apply if you chose that bucket.
    // Counts are scoped to the current free-text query so they make sense
    // when the user is also typing.
    const segmentFacets: Record<string, number> = {};
    const eraFacets: Record<string, number> = {};
    const bodyFacets: Record<string, number> = {};
    const decadeFacets: Record<string, number> = {};
    let unclassifiedSegment = 0;
    for (const c of queryFiltered) {
      if (c.segment) {
        segmentFacets[c.segment] = (segmentFacets[c.segment] ?? 0) + 1;
      } else {
        unclassifiedSegment += 1;
      }
      eraFacets[c.era] = (eraFacets[c.era] ?? 0) + 1;
      if (c.bodyStyle) bodyFacets[c.bodyStyle] = (bodyFacets[c.bodyStyle] ?? 0) + 1;
      const dec = decadeOf(c.year);
      decadeFacets[dec] = (decadeFacets[dec] ?? 0) + 1;
    }

    // Step 3: apply the structured filters. Each param accepts a single
    // value or a comma-separated list (multi-select).
    let filtered = queryFiltered;
    if (segmentParam) {
      const wanted = new Set(segmentParam.split(",").map((s) => s.trim()).filter(Boolean));
      const includeUnclassified = wanted.delete("unclassified");
      const wantedSegs = new Set(
        [...wanted].map((s) => coerceSegment(s) ?? (s as Segment)),
      );
      filtered = filtered.filter((c) => {
        if (c.segment == null) return includeUnclassified;
        return wantedSegs.has(c.segment);
      });
    }
    if (eraParam) {
      const wanted = new Set(eraParam.split(",").map((s) => s.trim()).filter(Boolean));
      filtered = filtered.filter((c) => wanted.has(c.era));
    }
    if (bodyParam) {
      const wanted = new Set(bodyParam.split(",").map((s) => s.trim()).filter(Boolean));
      filtered = filtered.filter((c) => c.bodyStyle != null && wanted.has(c.bodyStyle));
    }
    if (decadeParam) {
      const wanted = decadeParam
        .split(",")
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n));
      if (wanted.length) {
        filtered = filtered.filter((c) => {
          const dec = Math.floor(c.year / 10) * 10;
          return wanted.includes(dec);
        });
      }
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
      facets: {
        segments: segmentFacets as Record<Segment, number>,
        unclassifiedSegment,
        eras: eraFacets,
        bodies: bodyFacets as Record<BodyStyle, number>,
        decades: decadeFacets,
        totalAfterQuery: queryFiltered.length,
      },
    });
  } catch (err) {
    log.error({ err: String(err) }, "search failed");
    return fail(apiError(ERROR_CODES.E001_CAR_SEARCH_FAILED, "Catalog search failed."), 500);
  }
}

void NextResponse;
