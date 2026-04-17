"use client";

import { cn } from "@/lib/cn";
import type { EventBanner as EventBannerData } from "@/engine/macro/events";

/**
 * v0.5 macro-shock banner strip.
 *
 * Renders the currently-active macro events on the dashboard. Tone drives
 * the color accent (positive = green, negative = amber, mixed = slate).
 * Severity drives border weight so a "strong" shock reads heavier than a
 * "mild" one at a glance.
 *
 * Empty state renders nothing — callers can conditionally mount this
 * component without creating dead space when no shocks are live.
 */
export interface EventBannerProps {
  banners: EventBannerData[];
  className?: string;
}

const TONE_CLASSES: Record<EventBannerData["tone"], string> = {
  positive:
    "bg-emerald-950/40 border-emerald-700/60 text-emerald-100",
  negative:
    "bg-amber-950/40 border-amber-700/60 text-amber-100",
  mixed:
    "bg-ink-900/60 border-ink-700 text-ink-100",
};

const TONE_DOT: Record<EventBannerData["tone"], string> = {
  positive: "bg-emerald-400",
  negative: "bg-amber-400",
  mixed: "bg-ink-300",
};

export function EventBanner({ banners, className }: EventBannerProps) {
  if (banners.length === 0) return null;
  return (
    <div className={cn("space-y-2", className)} data-testid="macro-shock-strip">
      {banners.map((b) => (
        <div
          key={b.id}
          className={cn(
            "rounded-xl border px-4 py-3 flex items-start gap-3",
            TONE_CLASSES[b.tone],
            b.severity === "strong" ? "border-2" : "border",
          )}
          data-defid={b.defId}
        >
          <span
            className={cn(
              "mt-1.5 h-2 w-2 rounded-full shrink-0",
              TONE_DOT[b.tone],
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold tracking-tight truncate">
                {b.title}
              </h4>
              <span className="text-[11px] text-ink-300 font-mono tabular-nums shrink-0">
                {b.weeksRemaining}w left
              </span>
            </div>
            <p className="text-xs text-ink-300 mt-0.5 leading-snug">
              {b.detail}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
