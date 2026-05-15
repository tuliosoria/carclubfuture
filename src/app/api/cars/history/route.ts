import type { NextRequest } from "next/server";
import { getCarBySlug } from "@/lib/db/car-search";
import { ok, fail } from "@/lib/api/envelope";
import { ERROR_CODES, apiError } from "@/lib/errors";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  if (!slug) return fail(apiError(ERROR_CODES.E008_INVALID_REQUEST, "Missing ?slug="), 400);
  const car = getCarBySlug(slug);
  if (!car || !car.price) {
    return fail(apiError(ERROR_CODES.E002_CAR_NOT_FOUND, `No history for slug ${slug}`), 404);
  }
  const base = car.price.valueUsd;
  const today = new Date();
  const points = Array.from({ length: 24 }).map((_, i) => {
    const d = new Date(today);
    d.setMonth(d.getMonth() - (23 - i));
    const monthsAgo = 23 - i;
    const trend = Math.pow(1.04, -monthsAgo / 12);
    return {
      month: d.toISOString().slice(0, 7),
      valueUsd: Math.round(base * trend),
    };
  });
  return ok({ slug, points });
}
