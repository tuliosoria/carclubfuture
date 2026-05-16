"use client";
import * as React from "react";
import Link from "next/link";
import { Search, RotateCcw } from "lucide-react";
import type {
  CollectorCar,
  Recommendation,
  Scenario,
  Segment,
  BodyStyle,
  Era,
} from "@/lib/types/cars";
import { SEGMENTS, ERA_DESCRIPTORS } from "@/lib/data/car-segments";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CarForecastCard } from "./car-forecast-card";
import { cn } from "@/lib/utils";
import { tokenize } from "@/lib/utils/string";

type SortKey = "current-value" | "projected-upside" | "confidence" | "auction-volume" | "rarity";

const ERAS: Era[] = [
  "pre-war",
  "post-war-classic",
  "muscle-era",
  "malaise",
  "modern-classic",
  "modern-collectible",
];
const BODIES: BodyStyle[] = ["coupe", "convertible", "sedan", "wagon", "truck", "suv"];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "current-value", label: "Current value" },
  { key: "projected-upside", label: "Projected upside" },
  { key: "confidence", label: "Confidence" },
  { key: "auction-volume", label: "Auction volume" },
  { key: "rarity", label: "Production rarity" },
];

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

export function ForecastDashboard({ initialCars }: { initialCars: CollectorCar[] }) {
  const [query, setQuery] = React.useState("");
  const [segments, setSegments] = React.useState<Set<Segment>>(new Set());
  const [eras, setEras] = React.useState<Set<Era>>(new Set());
  const [bodies, setBodies] = React.useState<Set<BodyStyle>>(new Set());
  const [recommendation, setRecommendation] = React.useState<Recommendation | "all">("all");
  const [scenario, setScenario] = React.useState<Scenario>("moderate");
  const [sortBy, setSortBy] = React.useState<SortKey>("projected-upside");

  const filtered = React.useMemo(() => {
    const tokens = tokenize(query);
    let list = initialCars;
    if (tokens.length) {
      list = list.filter((c) => {
        const hay = [c.displayName, ...c.searchAliases, c.segment ?? ""]
          .join(" ")
          .toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    }
    if (segments.size) list = list.filter((c) => c.segment != null && segments.has(c.segment));
    if (eras.size) list = list.filter((c) => eras.has(c.era));
    if (bodies.size) list = list.filter((c) => c.bodyStyle != null && bodies.has(c.bodyStyle));
    if (recommendation !== "all") {
      list = list.filter((c) => c.forecast?.recommendation === recommendation);
    }
    return [...list].sort((a, b) => {
      const af = a.forecast;
      const bf = b.forecast;
      switch (sortBy) {
        case "current-value":
          return (b.price?.valueUsd ?? 0) - (a.price?.valueUsd ?? 0);
        case "confidence":
          return (
            (bf ? CONFIDENCE_RANK[bf.confidence] : 0) -
            (af ? CONFIDENCE_RANK[af.confidence] : 0)
          );
        case "auction-volume":
          return (b.price?.auctionCount12mo ?? 0) - (a.price?.auctionCount12mo ?? 0);
        case "rarity":
          return (a.productionTotal ?? Infinity) - (b.productionTotal ?? Infinity);
        case "projected-upside":
        default:
          return (bf?.cagr5yr ?? 0) - (af?.cagr5yr ?? 0);
      }
    });
  }, [initialCars, query, segments, eras, bodies, recommendation, sortBy]);

  const segmentCounts = React.useMemo(() => {
    const counts = new Map<Segment, number>();
    for (const c of initialCars) {
      if (c.segment == null) continue;
      counts.set(c.segment, (counts.get(c.segment) ?? 0) + 1);
    }
    return counts;
  }, [initialCars]);

  // ─── Pagination: cap the rendered window to keep the DOM sane.
  // Filters/sort apply to the full dataset, but only `visibleCount` cards
  // are mounted. "Show more" appends another PAGE_SIZE to the window.
  const PAGE_SIZE = 60;
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  React.useEffect(() => {
    // Reset window whenever the filtered list changes (new search, etc.)
    setVisibleCount(PAGE_SIZE);
  }, [query, segments, eras, bodies, recommendation, sortBy]);
  const visible = React.useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  const filtersActive =
    query.length > 0 ||
    segments.size > 0 ||
    eras.size > 0 ||
    bodies.size > 0 ||
    recommendation !== "all";

  function reset() {
    setQuery("");
    setSegments(new Set());
    setEras(new Set());
    setBodies(new Set());
    setRecommendation("all");
    setScenario("moderate");
    setSortBy("projected-upside");
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-6 py-10 md:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto">
        <div className="space-y-6 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Filters
            </h2>
            {filtersActive ? (
              <button
                onClick={reset}
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            ) : null}
          </div>

          <FilterGroup label="Segment">
            {SEGMENTS.map((s) => (
              <CheckboxRow
                key={s.id}
                label={s.shortName}
                count={segmentCounts.get(s.id) ?? 0}
                checked={segments.has(s.id)}
                onChange={() => toggle(setSegments, s.id)}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Era">
            {ERAS.map((e) => (
              <CheckboxRow
                key={e}
                label={ERA_DESCRIPTORS[e].label}
                hint={ERA_DESCRIPTORS[e].range}
                checked={eras.has(e)}
                onChange={() => toggle(setEras, e)}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Body style">
            {BODIES.map((b) => (
              <CheckboxRow
                key={b}
                label={cap(b)}
                checked={bodies.has(b)}
                onChange={() => toggle(setBodies, b)}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Recommendation">
            {(["all", "buy", "hold", "sell"] as const).map((r) => (
              <RadioRow
                key={r}
                name="rec"
                label={cap(r)}
                checked={recommendation === r}
                onChange={() => setRecommendation(r)}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Scenario">
            {(["pessimist", "moderate", "optimist"] as const).map((s) => (
              <RadioRow
                key={s}
                name="scn"
                label={cap(s)}
                checked={scenario === s}
                onChange={() => setScenario(s)}
              />
            ))}
          </FilterGroup>
        </div>
      </aside>

      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by year, make, model, or segment alias…"
              className="pl-9"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Showing {Math.min(visibleCount, filtered.length)} of {filtered.length}
            {filtered.length !== initialCars.length ? ` (filtered from ${initialCars.length})` : ""}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {SORT_OPTIONS.map((o) => (
            <Button
              key={o.key}
              size="sm"
              variant={sortBy === o.key ? "primary" : "secondary"}
              onClick={() => setSortBy(o.key)}
            >
              {o.label}
            </Button>
          ))}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((car) => (
            <Link key={car.id} href={`/car-forecast/${car.slug}`}>
              <CarForecastCard car={car} scenario={scenario} />
            </Link>
          ))}
        </div>

        {visibleCount < filtered.length ? (
          <div className="mt-8 flex justify-center">
            <Button
              variant="secondary"
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
            >
              Show more ({filtered.length - visibleCount} remaining)
            </Button>
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <div className="mt-12 rounded-lg border border-dashed border-border bg-card p-10 text-center">
            <p className="text-foreground">No vehicles match these filters.</p>
            <Button onClick={reset} variant="secondary" className="mt-4">
              Reset filters
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function toggle<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, value: T) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function CheckboxRow({
  label,
  hint,
  count,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-muted", checked && "text-foreground")}> 
      <span className="flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={onChange} className="accent-amber-500" />
        <span>
          {label}
          {hint ? <span className="ml-1 text-xs text-muted-foreground">({hint})</span> : null}
        </span>
      </span>
      {count !== undefined ? (
        <span className="text-xs text-muted-foreground">{count}</span>
      ) : null}
    </label>
  );
}

function RadioRow({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="accent-amber-500" />
      <span>{label}</span>
    </label>
  );
}
