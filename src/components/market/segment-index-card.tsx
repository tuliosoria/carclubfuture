"use client";
import * as React from "react";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import type { SegmentIndex } from "@/lib/types/cars";
import type { SegmentDescriptor } from "@/lib/data/car-segments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatPercent } from "@/lib/utils";

void React;

export function SegmentIndexCard({ data, descriptor }: { data: SegmentIndex; descriptor: SegmentDescriptor | undefined }) {
  const positive = data.quarterlyChangePct >= 0;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{descriptor?.shortName ?? data.segment}</CardTitle>
            <p className="text-xs text-muted-foreground">{data.componentCount} components</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums">{data.current.toFixed(1)}</p>
            <p className={cn("text-xs", positive ? "text-emerald-400" : "text-rose-400")}>
              {positive ? "▲" : "▼"} {formatPercent(Math.abs(data.quarterlyChangePct), 1)} QoQ
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-20">
          <ResponsiveContainer>
            <LineChart data={data.history}>
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Line
                type="monotone"
                dataKey="indexValue"
                stroke={positive ? "#10b981" : "#f43f5e"}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>{data.history[0]?.quarter}</span>
          <span>{data.history.at(-1)?.quarter}</span>
        </div>
      </CardContent>
    </Card>
  );
}
