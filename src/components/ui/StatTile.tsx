"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface StatTileProps {
  label: string;
  value: ReactNode;
  delta?: number; // positive good, negative bad
  hint?: string;
  className?: string;
}

export function StatTile({ label, value, delta, hint, className }: StatTileProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-ink-800 bg-ink-900/60 p-3 sm:p-4 min-w-0",
        className,
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-ink-400 font-medium">
        {label}
      </div>
      <div className="mt-1 text-lg sm:text-xl font-semibold text-ink-50 font-mono tabular-nums truncate">
        {value}
      </div>
      {(typeof delta === "number" || hint) && (
        <div className="mt-1 text-xs text-ink-400 flex items-center gap-2">
          {typeof delta === "number" && (
            <span
              className={cn(
                "font-medium tabular-nums",
                delta > 0 && "text-money",
                delta < 0 && "text-loss",
              )}
            >
              {delta > 0 ? "+" : ""}
              {delta.toFixed(1)}%
            </span>
          )}
          {hint && <span className="truncate">{hint}</span>}
        </div>
      )}
    </div>
  );
}
