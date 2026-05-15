"use client";
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RestorationCalculator } from "@/components/calculator/restoration-calculator";
import { FlipCalculator } from "@/components/calculator/flip-calculator";
import { HoldCalculator } from "@/components/calculator/hold-calculator";

type Tab = "restoration" | "flip" | "hold";

const TABS: { key: Tab; label: string; description: string }[] = [
  { key: "restoration", label: "Restoration ROI", description: "Buy a project car, restore it, sell it." },
  { key: "flip", label: "Flip ROI", description: "Cosmetic + small mechanical fixes, quick resale." },
  { key: "hold", label: "Hold ROI", description: "Carry costs and net return on a car you already own." },
];

export default function CalculatorPage() {
  const [tab, setTab] = React.useState<Tab>("restoration");
  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-12">
      <header>
        <p className="text-xs uppercase tracking-wider text-accent">Calculator</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-tight">ROI calculators</h1>
        <p className="mt-3 text-muted-foreground">
          Quick estimates — auction fees included (BaT 5%, Cars &amp; Bids 4.5%) and default
          monthly hold costs ($200 storage + $80 insurance) baked in.
        </p>
      </header>

      <div role="tablist" aria-label="Calculator type" className="flex flex-wrap gap-2 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-accent text-accent"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{active.label}</CardTitle>
          <p className="text-sm text-muted-foreground">{active.description}</p>
        </CardHeader>
        <CardContent>
          {tab === "restoration" ? <RestorationCalculator /> : null}
          {tab === "flip" ? <FlipCalculator /> : null}
          {tab === "hold" ? <HoldCalculator /> : null}
        </CardContent>
      </Card>
    </div>
  );
}
