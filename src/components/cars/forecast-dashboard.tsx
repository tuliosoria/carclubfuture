"use client";
import * as React from "react";
import Link from "next/link";
import { Search, RotateCcw, Loader2, SlidersHorizontal, X, TrendingUp } from "lucide-react";
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
const DECADES: number[] = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "current-value", label: "Current value" },
  { key: "projected-upside", label: "Projected upside" },
  { key: "confidence", label: "Confidence" },
  { key: "auction-volume", label: "Auction volume" },
  { key: "rarity", label: "Production rarity" },
];

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

interface Facets {
  segments: Partial<Record<Segment, number>>;
  unclassifiedSegment: number;
  eras: Partial<Record<Era, number>>;
  bodies: Partial<Record<BodyStyle, number>>;
  decades: Record<string, number>;
  totalAfterQuery: number;
}

interface SearchResponse {
  success: boolean;
  data?: {
    results: CollectorCar[];
    count: number;
    total: number;
    offset: number;
    limit: number;
    facets?: Facets;
  };
}

interface DashboardProps {
  initialCars: CollectorCar[];
  totalCount: number;
  pageSize?: number;
  topPicks?: CollectorCar[];
}

export function ForecastDashboard({
  initialCars,
  totalCount,
  pageSize = 60,
  topPicks = [],
}: DashboardProps) {
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [segments, setSegments] = React.useState<Set<Segment | "unclassified">>(new Set());
  const [eras, setEras] = React.useState<Set<Era>>(new Set());
  const [bodies, setBodies] = React.useState<Set<BodyStyle>>(new Set());
  const [decades, setDecades] = React.useState<Set<number>>(new Set());
  const [recommendation, setRecommendation] = React.useState<Recommendation | "all">("all");
  const [scenario, setScenario] = React.useState<Scenario>("moderate");
  const [sortBy, setSortBy] = React.useState<SortKey>("projected-upside");
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false);

  // Lock body scroll when mobile drawer is open + close on Escape.
  React.useEffect(() => {
    if (!mobileFiltersOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileFiltersOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileFiltersOpen]);

  // ─── Server-paginated state.
  const [cars, setCars] = React.useState<CollectorCar[]>(initialCars);
  const [serverTotal, setServerTotal] = React.useState<number>(totalCount);
  const [facets, setFacets] = React.useState<Facets | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const reqIdRef = React.useRef(0);

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  // All structured filters are now server-side. Multi-select uses
  // comma-separated values per dimension.
  const apiQuery = debouncedQuery;
  const segmentCsv = [...segments].join(",");
  const eraCsv = [...eras].join(",");
  const bodyCsv = [...bodies].join(",");
  const decadeCsv = [...decades].join(",");
  const apiRecommendation = recommendation;
  const apiKey = `${apiQuery}|${segmentCsv}|${eraCsv}|${bodyCsv}|${decadeCsv}|${apiRecommendation}`;

  const buildUrl = React.useCallback(
    (offset: number, limit: number) => {
      const sp = new URLSearchParams();
      if (apiQuery) sp.set("q", apiQuery);
      if (segmentCsv) sp.set("segment", segmentCsv);
      if (eraCsv) sp.set("era", eraCsv);
      if (bodyCsv) sp.set("body", bodyCsv);
      if (decadeCsv) sp.set("decade", decadeCsv);
      if (apiRecommendation && apiRecommendation !== "all") {
        sp.set("recommendation", apiRecommendation);
      }
      sp.set("offset", String(offset));
      sp.set("limit", String(limit));
      return `/api/cars/search?${sp.toString()}`;
    },
    [apiQuery, segmentCsv, eraCsv, bodyCsv, decadeCsv, apiRecommendation],
  );

  const isInitialState =
    apiQuery === "" &&
    segments.size === 0 &&
    eras.size === 0 &&
    bodies.size === 0 &&
    decades.size === 0 &&
    apiRecommendation === "all";

  // Always fetch on mount once to populate facets, even in initial state.
  const facetsLoadedRef = React.useRef(false);

  React.useEffect(() => {
    if (isInitialState && facetsLoadedRef.current) {
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
        if (json.data.facets) setFacets(json.data.facets);
        facetsLoadedRef.current = true;
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
      if (json.data.facets) setFacets(json.data.facets);
    } catch (e) {
      if (myReq !== reqIdRef.current) return;
      setError(e instanceof Error ? e.message : "search failed");
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }

  // All structured filters are server-side now. Only sort is local.
  const sortedCars = React.useMemo(() => {
    return [...cars].sort((a, b) => {
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
  }, [cars, sortBy]);

  const filtersActive =
    query.length > 0 ||
    segments.size > 0 ||
    eras.size > 0 ||
    bodies.size > 0 ||
    decades.size > 0 ||
    recommendation !== "all";

  const hasMore = cars.length < serverTotal;

  function reset() {
    setQuery("");
    setSegments(new Set());
    setEras(new Set());
    setBodies(new Set());
    setDecades(new Set());
    setRecommendation("all");
    setScenario("moderate");
    setSortBy("projected-upside");
  }

  const showTopPicks = isInitialState && topPicks.length > 0;
  const activeFilterCount =
    segments.size + eras.size + bodies.size + decades.size + (recommendation !== "all" ? 1 : 0);

  const filterPanel = (
    <div className="space-y-6 border border-border bg-surface-elevated p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-overline uppercase text-foreground-muted">
          Filters
        </h2>
        <div className="flex items-center gap-2">
          {filtersActive ? (
            <button
              onClick={reset}
              className="inline-flex items-center gap-1 text-meta uppercase tracking-[0.04em] text-papaya hover:text-papaya-hover"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(false)}
            aria-label="Close filters"
            className="md:hidden -mr-1 rounded-sm p-1 text-foreground-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <FilterGroup label="Decade">
        {DECADES.map((d) => (
          <CheckboxRow
            key={d}
            label={`${d}s`}
            count={facets?.decades[`${d}s`] ?? 0}
            checked={decades.has(d)}
            onChange={() => toggle(setDecades, d)}
          />
        ))}
      </FilterGroup>

      <FilterGroup label="Segment">
        {SEGMENTS.map((s) => (
          <CheckboxRow
            key={s.id}
            label={s.shortName}
            count={facets?.segments[s.id] ?? 0}
            checked={segments.has(s.id)}
            onChange={() => toggle<Segment | "unclassified">(setSegments, s.id)}
          />
        ))}
        <CheckboxRow
          label="Unclassified"
          hint="no segment match"
          count={facets?.unclassifiedSegment ?? 0}
          checked={segments.has("unclassified")}
          onChange={() => toggle<Segment | "unclassified">(setSegments, "unclassified")}
        />
      </FilterGroup>

      <FilterGroup label="Era">
        {ERAS.map((e) => (
          <CheckboxRow
            key={e}
            label={ERA_DESCRIPTORS[e].label}
            hint={ERA_DESCRIPTORS[e].range}
            count={facets?.eras[e] ?? 0}
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
            count={facets?.bodies[b] ?? 0}
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

      {/* Apply button — mobile only, closes the drawer */}
      <div className="md:hidden pt-2">
        <Button
          onClick={() => setMobileFiltersOpen(false)}
          className="w-full"
        >
          Show {serverTotal.toLocaleString()} {serverTotal === 1 ? "result" : "results"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto grid w-full max-w-[1440px] gap-8 overflow-x-clip px-4 py-10 sm:px-8 md:grid-cols-[280px_minmax(0,1fr)]">
      {/* Desktop sticky sidebar */}
      <aside className="hidden md:block md:sticky md:top-24 md:max-h-[calc(100vh-7rem)] md:min-w-0 md:overflow-y-auto">
        {filterPanel}
      </aside>

      {/* Mobile drawer */}
      {mobileFiltersOpen ? (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close filter overlay"
            onClick={() => setMobileFiltersOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <aside
            aria-label="Filters"
            className="absolute left-0 top-0 h-full w-[88vw] max-w-sm overflow-y-auto bg-surface p-4 shadow-2xl"
          >
            {filterPanel}
          </aside>
        </div>
      ) : null}

      <section className="min-w-0">
        {/* Top picks — only when no query/filters active */}
        {showTopPicks ? (
          <div className="mb-8">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-papaya" />
              <h2 className="text-overline uppercase text-foreground-muted">
                Top picks · highest 5y upside
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {topPicks.map((car) => (
                <Link
                  key={car.id}
                  href={`/car-forecast/${car.slug}`}
                  className="group block rounded-sm border border-border bg-surface-elevated p-3 transition-colors hover:border-papaya/60"
                >
                  <p className="line-clamp-2 text-sm font-semibold text-foreground">
                    {car.displayName}
                  </p>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {car.segment ?? "—"}
                  </p>
                  <p className="mt-2 font-mono text-sm font-bold text-buy tabular-nums">
                    +{((car.forecast?.cagr5yr ?? 0) * 100).toFixed(1)}% 5y
                  </p>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full min-w-0 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by year, make, model…"
              className="w-full pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
            {/* Mobile filter trigger */}
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(true)}
              aria-label="Open filters"
              className="md:hidden inline-flex shrink-0 items-center gap-2 rounded-sm border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground hover:border-papaya/60"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 ? (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-papaya px-1.5 text-[10px] font-bold text-papaya-foreground">
                  {activeFilterCount}
                </span>
              ) : null}
            </button>
            <p className="text-sm text-foreground-muted">
              Showing <span className="font-mono text-foreground tabular-nums">{sortedCars.length.toLocaleString()}</span> of <span className="font-mono text-foreground tabular-nums">{serverTotal.toLocaleString()}</span>
              {loading ? (
                <Loader2 className="ml-2 inline h-3 w-3 animate-spin text-papaya" />
              ) : null}
            </p>
          </div>
        </div>

        <div className="mt-4 -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {SORT_OPTIONS.map((o) => (
            <Button
              key={o.key}
              size="sm"
              variant={sortBy === o.key ? "primary" : "secondary"}
              onClick={() => setSortBy(o.key)}
              className="shrink-0"
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
          {sortedCars.map((car) => (
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

        {!loading && sortedCars.length === 0 ? (
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
