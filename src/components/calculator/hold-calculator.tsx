"use client";
import * as React from "react";
import { calcHold } from "@/lib/domain/calculators";
import { NumberField, ChannelSelect, ResultRow, fmtUsd, fmtPct } from "./shared";

export function HoldCalculator() {
  const [current, setCurrent] = React.useState(75000);
  const [cagr, setCagr] = React.useState(5);
  const [years, setYears] = React.useState(5);
  const [storage, setStorage] = React.useState(200);
  const [insurance, setInsurance] = React.useState(80);
  const [channel, setChannel] = React.useState<"bat" | "cars-and-bids" | "private">("bat");

  const r = calcHold({
    currentValueUsd: current,
    cagrPct: cagr / 100,
    yearsHeld: years,
    monthlyStorageUsd: storage,
    monthlyInsuranceUsd: insurance,
    saleChannel: channel,
  });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3">
        <NumberField name="current" label="Current market value" value={current} onChange={setCurrent} step={500} />
        <NumberField name="cagr" label="Forecasted CAGR (%)" value={cagr} onChange={setCagr} step={0.5} />
        <NumberField name="years" label="Years held" value={years} onChange={setYears} step={1} />
        <NumberField name="storage" label="Monthly storage" value={storage} onChange={setStorage} step={25} />
        <NumberField name="insurance" label="Monthly insurance" value={insurance} onChange={setInsurance} step={10} />
        <ChannelSelect value={channel} onChange={setChannel} />
      </div>
      <div className="rounded-lg border border-border bg-background p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Result</h3>
        <div className="mt-2">
          <ResultRow label="Future value" value={fmtUsd(r.futureValueUsd)} />
          <ResultRow label="Total carry costs" value={fmtUsd(r.totalCostsUsd)} />
          <ResultRow label="Auction fees" value={fmtUsd(r.feesUsd)} />
          <ResultRow label="Net sale" value={fmtUsd(r.netSaleUsd)} />
          <ResultRow label="Net profit" value={fmtUsd(r.netProfitUsd)} tone={r.netProfitUsd >= 0 ? "good" : "bad"} />
          <ResultRow label="Net ROI" value={fmtPct(r.netRoiPct)} tone={r.netRoiPct >= 0 ? "good" : "bad"} />
          <ResultRow label="Annualized net ROI" value={fmtPct(r.annualizedNetRoiPct)} tone={r.annualizedNetRoiPct >= 0 ? "good" : "bad"} />
        </div>
      </div>
    </div>
  );
}
