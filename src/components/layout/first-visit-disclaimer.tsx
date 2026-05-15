"use client";
import * as React from "react";
import Link from "next/link";

const KEY = "ccf.disclaimer.v1";

export function FirstVisitDisclaimer() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot init from localStorage on mount
        setOpen(true);
      }
    } catch {
      // ignore (SSR / private mode)
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  if (!open) return null;
  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-lg border border-border bg-card p-4 text-sm text-card-foreground shadow-lg">
      <p className="font-medium text-foreground">Not financial advice</p>
      <p className="mt-1 text-muted-foreground">
        CarClubFuture forecasts are statistical estimates based on auction data and are
        provided for informational purposes only. Markets fluctuate and past performance
        does not guarantee future results.{" "}
        <Link href="/car-forecast/methodology" className="text-accent hover:underline">
          Read the methodology →
        </Link>
      </p>
      <div className="mt-3 flex justify-end">
        <button
          onClick={dismiss}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
