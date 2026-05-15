import { Suspense } from "react";
import { loadStoredCatalog } from "@/lib/db/car-search";
import { hydrateForecast } from "@/lib/domain/car-forecast";
import { ForecastDashboard } from "@/components/cars/forecast-dashboard";

export const metadata = { title: "Catalog · Buy / Hold / Sell signals" };
export const dynamic = "force-static";

export default function CarForecastPage() {
  const cars = loadStoredCatalog().map(hydrateForecast);
  return (
    <Suspense fallback={null}>
      <ForecastDashboard initialCars={cars} />
    </Suspense>
  );
}
