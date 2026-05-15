"use client";
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { AuctionComp } from "@/lib/types/cars";

interface ApiResp {
  success: boolean;
  data?: { slug: string; comps: AuctionComp[] };
}

export function AuctionCompsTable({ slug }: { slug: string; fallbackBaseValue: number }) {
  const [comps, setComps] = React.useState<AuctionComp[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/cars/auction-comps?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j: ApiResp) => {
        if (cancelled) return;
        if (j.success && j.data) setComps(j.data.comps);
        else setError("No auction comps available.");
      })
      .catch(() => !cancelled && setError("Failed to load comps."));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent auction comps</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
        {!comps && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {comps?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2">Date</th>
                  <th>Channel</th>
                  <th>Sold</th>
                  <th>Reserve</th>
                  <th>Mileage</th>
                </tr>
              </thead>
              <tbody>
                {comps.map((c, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="py-2">{c.date}</td>
                    <td className="capitalize">{c.channel.replace(/-/g, " ")}</td>
                    <td>{c.soldPriceUsd ? formatCurrency(c.soldPriceUsd) : "—"}</td>
                    <td className={c.reserveMet ? "text-emerald-400" : "text-muted-foreground"}>
                      {c.reserveMet ? "Met" : "Not met"}
                    </td>
                    <td>{c.mileage ? c.mileage.toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
