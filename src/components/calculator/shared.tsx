"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatPercent } from "@/lib/utils";

export interface FieldDef {
  name: string;
  label: string;
  hint?: string;
  type?: "number";
  step?: number;
  min?: number;
}

export function NumberField({
  name,
  label,
  hint,
  value,
  onChange,
  step = 100,
  min = 0,
}: {
  name: string;
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <Input
        name={name}
        type="number"
        step={step}
        min={min}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const v = Number(e.target.value);
          onChange(Number.isFinite(v) ? v : 0);
        }}
      />
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function ChannelSelect({
  value,
  onChange,
}: {
  value: "bat" | "cars-and-bids" | "private";
  onChange: (v: "bat" | "cars-and-bids" | "private") => void;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-foreground">Sale channel</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as "bat" | "cars-and-bids" | "private")}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground"
      >
        <option value="bat">Bring a Trailer (5%, cap $7.5k)</option>
        <option value="cars-and-bids">Cars &amp; Bids (4.5%, cap $4.5k)</option>
        <option value="private">Private sale (no fee)</option>
      </select>
    </label>
  );
}

export function ResultRow({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "good" | "bad" }) {
  const cls = tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-rose-400" : "text-foreground";
  return (
    <div className="flex items-center justify-between border-b border-border/50 py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-medium ${cls}`}>{value}</span>
    </div>
  );
}

export function fmtUsd(n: number) {
  return formatCurrency(Math.round(n));
}

export function fmtPct(n: number) {
  return formatPercent(n, 1);
}
