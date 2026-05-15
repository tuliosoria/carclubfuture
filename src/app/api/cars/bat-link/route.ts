import type { NextRequest } from "next/server";
import { getCarBySlug } from "@/lib/db/car-search";
import { buildBatSearchUrl } from "@/lib/domain/car-bat-link";
import { ok, fail } from "@/lib/api/envelope";
import { ERROR_CODES, apiError } from "@/lib/errors";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  if (!slug) return fail(apiError(ERROR_CODES.E008_INVALID_REQUEST, "Missing ?slug="), 400);
  const car = getCarBySlug(slug);
  if (!car) return fail(apiError(ERROR_CODES.E002_CAR_NOT_FOUND, "Unknown slug"), 404);
  return ok({ slug, url: buildBatSearchUrl(car) });
}
