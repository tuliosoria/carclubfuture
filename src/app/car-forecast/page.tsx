import { Suspense } from "react";
import { loadStoredCatalog } from "@/lib/db/car-search";
import { hydrateForecast } from "@/lib/domain/car-forecast";
import { ForecastDashboard } from "@/components/cars/forecast-dashboard";
import { SectionHeader } from "@/components/ui/section-header";

export const metadata = { title: "Catalog · Buy / Hold / Sell signals" };
export const dynamic = "force-static";

const INITIAL_PAGE_SIZE = 60;

export default function CarForecastPage() {
  const all = loadStoredCatalog();
  const totalCount = all.length;
  const initialCars = all.slice(0, INITIAL_PAGE_SIZE).map(hydrateForecast);
  return (
    <Suspense fallback={null}>
      <div className="mx-auto max-w-[1440px] px-4 pt-10 sm:px-8">
        <SectionHeader
          overline="Forecast"
          title="Catalog"
          subtitle={`${totalCount.toLocaleString()} collectible vehicles. Buy / Hold / Sell signals where auction data supports a confident call.`}
        />
      </div>
      <ForecastDashboard
        initialCars={initialCars}
        totalCount={totalCount}
        pageSize={INITIAL_PAGE_SIZE}
      />
    </Suspense>
  );
}
