import { cn } from "@/lib/utils";
import type { Recommendation } from "@/lib/types/cars";
import { REC_COLOR, REC_LABEL } from "@/lib/domain/recommendation";

export function SignalBadge({ recommendation, className }: { recommendation: Recommendation; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider",
        REC_COLOR[recommendation],
        className
      )}
    >
      {REC_LABEL[recommendation]}
    </span>
  );
}
