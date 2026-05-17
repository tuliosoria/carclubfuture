import { Suspense } from "react";
import { loadStoredCatalog } from "@/lib/db/car-search";
import { hydrateForecast } from "@/lib/domain/car-forecast";
import { ForecastDashboard } from "@/components/cars/forecast-dashboard";
import { SectionHeader } from "@/components/ui/section-header";

export const metadata = { title: "Catalog · Buy / Hold / Sell signals" };
export const dynamic = "force-static";

const INITIAL_PAGE_SIZE = 60;
const TOP_PICK_COUNT = 6;

export default function CarForecastPage() {
  const all = loadStoredCatalog();
  const totalCount = all.length;
  const hydratedAll = all.map(hydrateForecast);
  const initialCars = hydratedAll.slice(0, INITIAL_PAGE_SIZE);
  const topPicks = hydratedAll
    .filter((c) => c.forecast?.recommendation === "buy")
    .sort((a, b) => (b.forecast?.cagr5yr ?? 0) - (a.forecast?.cagr5yr ?? 0))
    .slice(0, TOP_PICK_COUNT);
  return (
    <Suspense fallback={null}>
      <div className="mx-auto max-w-[1440px] px-4 pt-10 sm:px-8">
        <SectionHeader
          overline="Forecast"
          title="Catalog"
          subtitle={`${totalCount.toLocaleString()} collectible vehicles with confident Buy / Hold / Sell signals, built on real auction data.`}
        />
      </div>
      <ForecastDashboard
        initialCars={initialCars}
        totalCount={totalCount}
        pageSize={INITIAL_PAGE_SIZE}
        topPicks={topPicks}
      />
    </Suspense>
  );
}
