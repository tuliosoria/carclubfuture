"use client";
import * as React from "react";
import { calcRestoration } from "@/lib/domain/calculators";
import { NumberField, ChannelSelect, ResultRow, fmtUsd, fmtPct } from "./shared";

export function RestorationCalculator() {
  const [purchase, setPurchase] = React.useState(15000);
  const [resto, setResto] = React.useState(40000);
  const [postValue, setPostValue] = React.useState(85000);
  const [months, setMonths] = React.useState(18);
  const [channel, setChannel] = React.useState<"bat" | "cars-and-bids" | "private">("bat");

  const r = calcRestoration({
    purchasePriceUsd: purchase,
    restorationCostUsd: resto,
    postRestoMarketValueUsd: postValue,
    monthsToComplete: months,
    saleChannel: channel,
  });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3">
        <NumberField name="purchase" label="Purchase price" value={purchase} onChange={setPurchase} step={500} />
        <NumberField name="resto" label="Restoration budget" value={resto} onChange={setResto} step={500} />
        <NumberField name="postValue" label="Post-restoration market value" value={postValue} onChange={setPostValue} step={500} />
        <NumberField name="months" label="Months to complete" value={months} onChange={setMonths} step={1} />
        <ChannelSelect value={channel} onChange={setChannel} />
      </div>
      <div className="rounded-lg border border-border bg-background p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Result</h3>
        <div className="mt-2">
          <ResultRow label="Total in (purchase + resto + storage)" value={fmtUsd(r.totalInUsd)} />
          <ResultRow label="Auction fees" value={fmtUsd(r.feesUsd)} />
          <ResultRow label="Net sale proceeds" value={fmtUsd(r.netSaleUsd)} />
          <ResultRow label="Net profit" value={fmtUsd(r.profitUsd)} tone={r.profitUsd >= 0 ? "good" : "bad"} />
          <ResultRow label="ROI" value={fmtPct(r.roiPct)} tone={r.roiPct >= 0 ? "good" : "bad"} />
          <ResultRow label="Annualized ROI" value={fmtPct(r.annualizedRoiPct)} tone={r.annualizedRoiPct >= 0 ? "good" : "bad"} />
        </div>
      </div>
    </div>
  );
}
