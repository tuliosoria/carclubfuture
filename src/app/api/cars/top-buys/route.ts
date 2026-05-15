import { loadStoredCatalog } from "@/lib/db/car-search";
import { hydrateForecast } from "@/lib/domain/car-forecast";
import { ok } from "@/lib/api/envelope";

export const runtime = "nodejs";

export function GET() {
  const all = loadStoredCatalog().map(hydrateForecast);
  const buys = all
    .filter((c) => c.forecast?.recommendation === "buy")
    .sort((a, b) => (b.forecast?.cagr5yr ?? 0) - (a.forecast?.cagr5yr ?? 0))
    .slice(0, 8);
  return ok({ results: buys });
}
