"use client";
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { multiplierFor, GRADE_LABEL, ALL_GRADES } from "@/lib/domain/condition-multipliers";
import type { ConditionGrade, Segment } from "@/lib/types/cars";

export function ConditionSelector({ segment, baseValueUsd }: { segment: Segment; baseValueUsd: number }) {
  const [grade, setGrade] = React.useState<ConditionGrade>(3);
  const m = multiplierFor(grade, segment);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Condition value</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {ALL_GRADES.map((g) => (
            <button
              key={g}
              onClick={() => setGrade(g)}
              className={`rounded-md border px-3 py-1.5 text-sm transition ${
                g === grade
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted-foreground hover:border-accent/40 hover:text-foreground"
              }`}
            >
              {GRADE_LABEL[g]}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Multiplier</span>
            <span>{m.toFixed(2)}×</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Estimated value</span>
            <span className="text-lg font-semibold text-accent">
              {formatCurrency(Math.round(baseValueUsd * m))}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
