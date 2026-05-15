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
    return fail(apiError(ERROR_CODES.E002_CAR_NOT_FOUND, `No data for slug ${slug}`), 404);
  }
  const base = car.price.valueUsd;
  const today = new Date();
  const comps = Array.from({ length: 5 }).map((_, i) => {
    const d = new Date(today);
    d.setMonth(d.getMonth() - i * 2);
    // Deterministic spread per-vehicle so SSR matches CSR.
    const variance = 0.92 + ((i * 37 + base) % 16) / 100;
    return {
      date: d.toISOString().slice(0, 10),
      channel: i % 2 === 0 ? ("bat" as const) : ("cars-and-bids" as const),
      soldPriceUsd: Math.round(base * variance),
      reserveMet: variance > 0.97,
      mileage: 38_000 + (i * 9_137) % 50_000,
      conditionGrade: (i % 4 === 0 ? 2 : 3) as 2 | 3,
      url: null,
    };
  });
  return ok({ slug, comps });
}
