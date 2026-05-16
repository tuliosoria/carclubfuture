import { Suspense } from "react";
import { loadStoredCatalog } from "@/lib/db/car-search";
import { hydrateForecast } from "@/lib/domain/car-forecast";
import { ForecastDashboard } from "@/components/cars/forecast-dashboard";

export const metadata = { title: "Catalog · Buy / Hold / Sell signals" };
export const dynamic = "force-static";

// First page rendered into static HTML. Keep this small so the page
// stays a tiny CDN-cacheable shell — the dashboard fetches subsequent
// batches from /api/cars/search at runtime.
const INITIAL_PAGE_SIZE = 60;

export default function CarForecastPage() {
  const all = loadStoredCatalog();
  const totalCount = all.length;
  const initialCars = all.slice(0, INITIAL_PAGE_SIZE).map(hydrateForecast);
  return (
    <Suspense fallback={null}>
      <ForecastDashboard
        initialCars={initialCars}
        totalCount={totalCount}
        pageSize={INITIAL_PAGE_SIZE}
      />
    </Suspense>
  );
}
