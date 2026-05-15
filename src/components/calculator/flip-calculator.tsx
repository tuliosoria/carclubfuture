"use client";
import * as React from "react";
import { calcFlip } from "@/lib/domain/calculators";
import { NumberField, ChannelSelect, ResultRow, fmtUsd, fmtPct } from "./shared";

export function FlipCalculator() {
  const [purchase, setPurchase] = React.useState(28000);
  const [cosmetic, setCosmetic] = React.useState(4000);
  const [sale, setSale] = React.useState(42000);
  const [months, setMonths] = React.useState(3);
  const [channel, setChannel] = React.useState<"bat" | "cars-and-bids" | "private">("cars-and-bids");

  const r = calcFlip({
    purchasePriceUsd: purchase,
    cosmeticBudgetUsd: cosmetic,
    expectedSaleUsd: sale,
    monthsToFlip: months,
    saleChannel: channel,
  });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3">
        <NumberField name="purchase" label="Purchase price" value={purchase} onChange={setPurchase} step={250} />
        <NumberField name="cosmetic" label="Cosmetic / detail budget" value={cosmetic} onChange={setCosmetic} step={100} />
        <NumberField name="sale" label="Expected sale price" value={sale} onChange={setSale} step={250} />
        <NumberField name="months" label="Months to flip" value={months} onChange={setMonths} step={1} />
        <ChannelSelect value={channel} onChange={setChannel} />
      </div>
      <div className="rounded-lg border border-border bg-background p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Result</h3>
        <div className="mt-2">
          <ResultRow label="Total in" value={fmtUsd(r.totalInUsd)} />
          <ResultRow label="Auction fees" value={fmtUsd(r.feesUsd)} />
          <ResultRow label="Net sale" value={fmtUsd(r.netSaleUsd)} />
          <ResultRow label="Net profit" value={fmtUsd(r.profitUsd)} tone={r.profitUsd >= 0 ? "good" : "bad"} />
          <ResultRow label="ROI" value={fmtPct(r.roiPct)} tone={r.roiPct >= 0 ? "good" : "bad"} />
          <ResultRow label="Annualized ROI" value={fmtPct(r.annualizedRoiPct)} tone={r.annualizedRoiPct >= 0 ? "good" : "bad"} />
        </div>
      </div>
    </div>
  );
}
