import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CollectorCar } from "@/lib/types/cars";

export function ModelDetails({ car }: { car: CollectorCar }) {
  const rows: { label: string; value: string }[] = [
    { label: "Year", value: String(car.year) },
    { label: "Make", value: car.make },
    { label: "Model", value: car.model },
    { label: "Trim", value: car.trim ?? "—" },
    { label: "Body style", value: car.bodyStyle },
    {
      label: "Engine",
      value: car.engineDisplacementCc
        ? `${(car.engineDisplacementCc / 1000).toFixed(1)} L${car.cylinders ? ` · ${car.cylinders}-cyl` : ""}`
        : "—",
    },
    {
      label: "Production",
      value: car.productionTotal ? car.productionTotal.toLocaleString() : "—",
    },
    { label: "Rarity", value: car.rarity },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Model details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          {rows.map((r) => (
            <React.Fragment key={r.label}>
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="text-right capitalize text-foreground">{r.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
