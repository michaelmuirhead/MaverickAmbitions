import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { useGameStore } from "@/state/store";
import { formatMoney } from "@/lib/money";
import type { GameEvent, GameEventKind } from "@/types/game";

/**
 * v0.7 Events feed upgrade.
 *
 * Groups active events by `kind`, lets the player filter by severity, and
 * supports batch dismissal. Severity is derived from the impact magnitude:
 *
 *   major  — |cashDelta| >= $500 or |reputationDelta| >= 3
 *   minor  — everything else
 *
 * Events don't carry an explicit businessId in the current model, so
 * grouping is by `kind`. When the event model gains a businessId (v0.8+),
 * swap the `groupKey` function to prefer it.
 */

export interface EventsFeedProps {
  events: GameEvent[];
}

type Severity = "major" | "minor";

const KIND_LABELS: Record<GameEventKind, string> = {
  macro_shock: "Macro",
  macro_shock_end: "Macro",
  business_event: "Business",
  personal_event: "Personal",
  rival_move: "Rivals",
  family_event: "Family",
  audit: "Audit",
  milestone: "Milestones",
};

const KIND_ICONS: Record<GameEventKind, string> = {
  macro_shock: "🌩️",
  macro_shock_end: "☀️",
  business_event: "🏢",
  personal_event: "👤",
  rival_move: "⚔️",
  family_event: "👨‍👩‍👧",
  audit: "🕵️",
  milestone: "🏁",
};

// Filter groups merge the two macro kinds into a single "Macro" pill.
type FilterKey = "all" | "business" | "macro" | "rival" | "personal" | "family" | "audit" | "milestone";

const FILTER_MATCH: Record<Exclude<FilterKey, "all">, GameEventKind[]> = {
  business: ["business_event"],
  macro: ["macro_shock", "macro_shock_end"],
  rival: ["rival_move"],
  personal: ["personal_event"],
  family: ["family_event"],
  audit: ["audit"],
  milestone: ["milestone"],
};

function severityOf(e: GameEvent): Severity {
  const cash = Math.abs(e.impact?.cashDelta ?? 0);
  const rep = Math.abs(e.impact?.reputationDelta ?? 0);
  if (cash >= 50_000 || rep >= 3) return "major";
  return "minor";
}

function groupKey(e: GameEvent): GameEventKind {
  return e.kind;
}

export function EventsFeed({ events }: EventsFeedProps) {
  const dismissEvent = useGameStore((s) => s.dismissEvent);

  const [kindFilter, setKindFilter] = useState<FilterKey>("all");
  const [majorOnly, setMajorOnly] = useState(false);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (majorOnly && severityOf(e) !== "major") return false;
      if (kindFilter === "all") return true;
      return FILTER_MATCH[kindFilter].includes(e.kind);
    });
  }, [events, kindFilter, majorOnly]);

  const groups = useMemo(() => {
    const m = new Map<GameEventKind, GameEvent[]>();
    for (const e of filtered) {
      const k = groupKey(e);
      const list = m.get(k) ?? [];
      list.push(e);
      m.set(k, list);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const dismissAllInGroup = (kind: GameEventKind) => {
    const list = groups.find(([k]) => k === kind)?.[1] ?? [];
    for (const e of list) dismissEvent(e.id);
  };

  if (events.length === 0) {
    return (
      <p className="text-sm text-ink-400">
        No events yet. Time advances when you unpause.
      </p>
    );
  }

  const filterPills: Array<{ key: FilterKey; label: string }> = [
    { key: "all", label: "All" },
    { key: "business", label: "Business" },
    { key: "macro", label: "Macro" },
    { key: "rival", label: "Rivals" },
    { key: "personal", label: "Personal" },
    { key: "family", label: "Family" },
    { key: "audit", label: "Audit" },
    { key: "milestone", label: "Milestones" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {filterPills.map((p) => {
          const active = kindFilter === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setKindFilter(p.key)}
              className={
                "text-[11px] uppercase tracking-wide px-2.5 py-1 rounded-full border transition " +
                (active
                  ? "bg-accent text-ink-950 border-accent-dark"
                  : "bg-ink-800 text-ink-300 border-ink-700 hover:border-ink-500")
              }
            >
              {p.label}
            </button>
          );
        })}
        <label className="flex items-center gap-1.5 text-[11px] text-ink-400 ml-auto cursor-pointer select-none">
          <input
            type="checkbox"
            checked={majorOnly}
            onChange={(e) => setMajorOnly(e.target.checked)}
            className="accent-accent"
          />
          Major only
        </label>
      </div>

      {groups.length === 0 ? (
        <p className="text-xs text-ink-500">
          No events match the current filter.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(([kind, list]) => (
            <div
              key={kind}
              className="rounded-xl border border-ink-800 bg-ink-900/40"
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-ink-800/60">
                <div className="text-xs font-semibold text-ink-100 uppercase tracking-wide">
                  {KIND_ICONS[kind]} {KIND_LABELS[kind]}
                  <span className="ml-2 text-ink-500 font-mono tabular-nums">
                    {list.length}
                  </span>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => dismissAllInGroup(kind)}
                >
                  Dismiss all
                </Button>
              </div>
              <ul className="divide-y divide-ink-800/60">
                {list.map((e) => {
                  const sev = severityOf(e);
                  const cash = e.impact?.cashDelta ?? 0;
                  return (
                    <li
                      key={e.id}
                      className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              "inline-block h-1.5 w-1.5 rounded-full " +
                              (sev === "major" ? "bg-accent" : "bg-ink-600")
                            }
                          />
                          <span className="font-medium text-ink-50 truncate">
                            {e.title}
                          </span>
                        </div>
                        <div className="text-xs text-ink-400 mt-0.5">
                          {e.detail}
                        </div>
                        {cash !== 0 && (
                          <div
                            className={
                              "text-[11px] font-mono tabular-nums mt-1 " +
                              (cash > 0 ? "text-money" : "text-loss")
                            }
                          >
                            {formatMoney(cash, { compact: true, sign: true })}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => dismissEvent(e.id)}
                        className="text-ink-500 hover:text-ink-200 text-xs px-1"
                        aria-label="Dismiss event"
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
