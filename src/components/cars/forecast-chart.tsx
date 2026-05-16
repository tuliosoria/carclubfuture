"use client";
import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import type { ProjectionPoint } from "@/lib/types/cars";
import { formatCurrency } from "@/lib/utils";

export function ForecastChart({ projection, baseValueUsd }: { projection: ProjectionPoint[]; baseValueUsd: number }) {
  const data = [
    { year: "Now", pessimistUsd: baseValueUsd, moderateUsd: baseValueUsd, optimistUsd: baseValueUsd },
    ...projection.map((p) => ({ ...p, year: `Yr ${p.year}` })),
  ];
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="upBand" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#ff8000" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#ff8000" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="downBand" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#71717a" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#71717a" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
          <XAxis dataKey="year" stroke="#a1a1aa" tickLine={false} />
          <YAxis stroke="#a1a1aa" tickFormatter={(v) => formatCurrency(Number(v), { compact: true })} width={70} />
          <Tooltip
            contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", color: "#fafafa" }}
            formatter={(v: number) => formatCurrency(v)}
          />
          <ReferenceLine y={baseValueUsd} stroke="#fbbf24" strokeDasharray="2 2" />
          <Area type="monotone" dataKey="optimistUsd" stroke="#ff8000" fill="url(#upBand)" name="Optimist" />
          <Area type="monotone" dataKey="moderateUsd" stroke="#fbbf24" fill="none" name="Moderate" />
          <Area type="monotone" dataKey="pessimistUsd" stroke="#71717a" fill="url(#downBand)" name="Pessimist" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
