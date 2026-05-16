"use client";
import * as React from "react";
import Link from "next/link";
import { Search, RotateCcw, Loader2 } from "lucide-react";
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

interface SearchResponse {
  success: boolean;
  data?: {
    results: CollectorCar[];
    count: number;
    total: number;
    offset: number;
    limit: number;
  };
}

interface DashboardProps {
  initialCars: CollectorCar[];
  totalCount: number;
  pageSize?: number;
}

export function ForecastDashboard({
  initialCars,
  totalCount,
  pageSize = 60,
}: DashboardProps) {
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [segments, setSegments] = React.useState<Set<Segment>>(new Set());
  const [eras, setEras] = React.useState<Set<Era>>(new Set());
  const [bodies, setBodies] = React.useState<Set<BodyStyle>>(new Set());
  const [recommendation, setRecommendation] = React.useState<Recommendation | "all">("all");
  const [scenario, setScenario] = React.useState<Scenario>("moderate");
  const [sortBy, setSortBy] = React.useState<SortKey>("projected-upside");

  // ─── Server-paginated state.
  const [cars, setCars] = React.useState<CollectorCar[]>(initialCars);
  const [serverTotal, setServerTotal] = React.useState<number>(totalCount);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const reqIdRef = React.useRef(0);

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  // The API supports q + (single) segment + recommendation. Multi-segment,
  // era, body, and sort are post-filters applied client-side over what
  // we've loaded.
  const apiSegment: Segment | null = segments.size === 1 ? [...segments][0] : null;
  const apiRecommendation = recommendation;
  const apiQuery = debouncedQuery;
  const apiKey = `${apiQuery}|${apiSegment ?? ""}|${apiRecommendation}`;

  const buildUrl = React.useCallback(
    (offset: number, limit: number) => {
      const sp = new URLSearchParams();
      if (apiQuery) sp.set("q", apiQuery);
      if (apiSegment) sp.set("segment", apiSegment);
      if (apiRecommendation && apiRecommendation !== "all") {
        sp.set("recommendation", apiRecommendation);
      }
      sp.set("offset", String(offset));
      sp.set("limit", String(limit));
      return `/api/cars/search?${sp.toString()}`;
    },
    [apiQuery, apiSegment, apiRecommendation],
  );

  const isInitialState =
    apiQuery === "" && apiSegment == null && apiRecommendation === "all";

  React.useEffect(() => {
    if (isInitialState) {
      // Restore the server-rendered initial slice when all API filters clear.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCars(initialCars);
      setServerTotal(totalCount);
      setError(null);
      return;
    }
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    fetch(buildUrl(0, pageSize))
      .then((r) => r.json() as Promise<SearchResponse>)
      .then((json) => {
        if (myReq !== reqIdRef.current) return;
        if (!json.success || !json.data) throw new Error("search failed");
        setCars(json.data.results);
        setServerTotal(json.data.total);
      })
      .catch((e: unknown) => {
        if (myReq !== reqIdRef.current) return;
        setError(e instanceof Error ? e.message : "search failed");
      })
      .finally(() => {
        if (myReq === reqIdRef.current) setLoading(false);
      });
  }, [apiKey, isInitialState, initialCars, totalCount, buildUrl, pageSize]);

  async function loadMore() {
    const offset = cars.length;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(offset, pageSize));
      const json = (await res.json()) as SearchResponse;
      if (myReq !== reqIdRef.current) return;
      if (!json.success || !json.data) throw new Error("search failed");
      setCars((prev) => [...prev, ...json.data!.results]);
      setServerTotal(json.data.total);
    } catch (e) {
      if (myReq !== reqIdRef.current) return;
      setError(e instanceof Error ? e.message : "search failed");
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }

  const postFiltered = React.useMemo(() => {
    let list = cars;
    if (segments.size > 1) {
      list = list.filter((c) => c.segment != null && segments.has(c.segment));
    }
    if (eras.size) list = list.filter((c) => eras.has(c.era));
    if (bodies.size) list = list.filter((c) => c.bodyStyle != null && bodies.has(c.bodyStyle));
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
  }, [cars, segments, eras, bodies, sortBy]);

  const segmentCounts = React.useMemo(() => {
    const counts = new Map<Segment, number>();
    for (const c of cars) {
      if (c.segment == null) continue;
      counts.set(c.segment, (counts.get(c.segment) ?? 0) + 1);
    }
    return counts;
  }, [cars]);

  const filtersActive =
    query.length > 0 ||
    segments.size > 0 ||
    eras.size > 0 ||
    bodies.size > 0 ||
    recommendation !== "all";

  const hasMore = cars.length < serverTotal;
  const clientFiltered = postFiltered.length !== cars.length;

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
    <div className="mx-auto grid max-w-[1440px] gap-8 px-4 py-10 sm:px-8 md:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="md:sticky md:top-24 md:max-h-[calc(100vh-7rem)] md:overflow-y-auto">
        <div className="space-y-6 border border-border bg-surface-elevated p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-overline uppercase text-foreground-muted">
              Filters
            </h2>
            {filtersActive ? (
              <button
                onClick={reset}
                className="inline-flex items-center gap-1 text-meta uppercase tracking-[0.04em] text-papaya hover:text-papaya-hover"
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
          <p className="text-sm text-foreground-muted">
            Showing <span className="font-mono text-foreground tabular-nums">{postFiltered.length.toLocaleString()}</span> of <span className="font-mono text-foreground tabular-nums">{serverTotal.toLocaleString()}</span>
            {clientFiltered ? ` (filtered from ${cars.length.toLocaleString()} loaded)` : ""}
            {loading ? (
              <Loader2 className="ml-2 inline h-3 w-3 animate-spin text-papaya" />
            ) : null}
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

        {error ? (
          <div className="mt-6 border border-sell/40 bg-sell/10 p-4 text-sm text-sell">
            Failed to load catalog: {error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {postFiltered.map((car) => (
            <Link key={car.id} href={`/car-forecast/${car.slug}`} className="block h-full">
              <CarForecastCard car={car} scenario={scenario} />
            </Link>
          ))}
        </div>

        {hasMore ? (
          <div className="mt-8 flex justify-center">
            <Button
              variant="secondary"
              onClick={loadMore}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
                </>
              ) : (
                `Show more (${(serverTotal - cars.length).toLocaleString()} remaining)`
              )}
            </Button>
          </div>
        ) : null}

        {!loading && postFiltered.length === 0 ? (
          <div className="mt-12 border border-dashed border-border bg-surface-elevated p-10 text-center">
            <p className="text-foreground">No vehicles match these filters.</p>
            <Button onClick={reset} variant="ghost" className="mt-4">
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
      <h3 className="mb-2 text-overline uppercase text-foreground-muted">
        {label}
      </h3>
      <div className="space-y-1">{children}</div>
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
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors duration-150 ease-out hover:bg-surface-overlay",
        checked && "bg-papaya/10 text-foreground"
      )}
    >
      <span className="flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={onChange} className="accent-papaya" />
        <span className={cn(checked && "text-papaya font-medium")}>
          {label}
          {hint ? <span className="ml-1 text-xs text-foreground-dim">({hint})</span> : null}
        </span>
      </span>
      {count !== undefined && count > 0 ? (
        <span className="font-mono text-xs text-foreground-dim tabular-nums">{count.toLocaleString()}</span>
      ) : null}
    </label>
  );
}

function RadioRow({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors duration-150 ease-out hover:bg-surface-overlay",
        checked && "text-papaya font-medium"
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="accent-papaya" />
      <span>{label}</span>
    </label>
  );
}
