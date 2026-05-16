import * as React from "react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  overline?: string;
  title: string;
  subtitle?: string;
  className?: string;
  as?: "h1" | "h2";
  right?: React.ReactNode;
}

export function SectionHeader({
  overline,
  title,
  subtitle,
  className,
  as = "h2",
  right,
}: SectionHeaderProps) {
  const Title = as;
  return (
    <div className={cn("border-t border-border-strong pt-6", className)}>
      <div className="flex items-end justify-between gap-6">
        <div>
          {overline ? (
            <div className="text-overline uppercase text-papaya mb-3">
              {overline}
            </div>
          ) : null}
          <Title className="font-display font-bold uppercase tracking-tight text-foreground text-3xl sm:text-5xl leading-[1.05]">
            {title}
          </Title>
          {subtitle ? (
            <p className="mt-3 max-w-2xl text-base text-foreground-muted">
              {subtitle}
            </p>
          ) : null}
        </div>
        {right ? <div className="hidden sm:block">{right}</div> : null}
      </div>
    </div>
  );
}
