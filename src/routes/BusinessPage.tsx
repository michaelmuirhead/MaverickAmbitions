/**
 * Portfolio overview (v0.7+). In v0.9 this page gains a second tab:
 * "Closed" — a graveyard of player businesses that liquidated or were
 * voluntarily closed. Postmortems live on `player.closedBusinesses` and
 * are never GC'd, so a dynasty-wide failure trail persists across
 * succession events.
 */
import { useState } from "react";
import { Link } from "react-router-dom";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

import { useGameStore } from "@/state/store";
import { selectPlayerBusinesses } from "@/state/selectors";
import { formatMoney } from "@/lib/money";
import { formatGameDate } from "@/lib/date";
import { getBusinessModule } from "@/engine/business/registry";

import type {
  Business,
  BusinessTypeId,
  ClosedBusinessRecord,
} from "@/types/game";

import type { CafeQualityTier } from "@/engine/business/cafe";
import type { LiquorTier, MenuProgram } from "@/engine/business/hospitality";
import type { CornerStoreState } from "@/engine/business/retail";
import type { CafeState } from "@/engine/business/cafe";
import type { BarState } from "@/engine/business/bar";
import type { RestaurantState } from "@/engine/business/restaurant";

const TYPE_ICON: Partial<Record<BusinessTypeId, string>> = {
  corner_store: "🏪",
  cafe: "☕",
  bar: "🍻",
  restaurant: "🍽️",
};

const CAFE_TIER_LABELS: Record<CafeQualityTier, string> = {
  basic: "Basic",
  craft: "Craft",
  premium: "Premium",
};

const LIQUOR_LABELS: Record<LiquorTier, string> = {
  well: "Well",
  call: "Call",
  top_shelf: "Top Shelf",
};

const PROGRAM_LABELS: Record<MenuProgram, string> = {
  diner: "Diner",
  bistro: "Bistro",
  chef_driven: "Chef-Driven",
};

function bizSubtitle(biz: Business): string {
  switch (biz.type) {
    case "cafe": {
      const st = biz.state as unknown as CafeState;
      return `${CAFE_TIER_LABELS[st.qualityTier]} tier`;
    }
    case "bar": {
      const st = biz.state as unknown as BarState;
      return `${LIQUOR_LABELS[st.liquorTier]} shelf`;
    }
    case "restaurant": {
      const st = biz.state as unknown as RestaurantState;
      return PROGRAM_LABELS[st.program];
    }
    default: {
      const st = biz.state as unknown as CornerStoreState;
      const skuCount = Object.keys(st.skus).length;
      return `${skuCount} SKUs`;
    }
  }
}

type TabKey = "active" | "closed";

export function BusinessPage() {
  const game = useGameStore((s) => s.game)!;
  const bizs = selectPlayerBusinesses(game);
  const closed = Object.values(game.player.closedBusinesses ?? {});
  const [tab, setTab] = useState<TabKey>("active");

  // Empty portfolio *and* no history → helpful landing copy.
  if (bizs.length === 0 && closed.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Your business</h1>
        <Card>
          <p className="text-sm text-ink-300">
            You don&apos;t own any businesses yet. Pick a neighborhood in the{" "}
            <Link to="/market" className="text-accent underline">
              Market
            </Link>{" "}
            and open your first corner store — or save up for a cafe, bar, or
            restaurant.
          </p>
        </Card>
      </div>
    );
  }

  const tabs: TabKey[] = closed.length > 0 ? ["active", "closed"] : ["active"];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Your businesses</h1>
        <p className="text-sm text-ink-400 mt-1">
          {bizs.length} active
          {closed.length > 0 && <> · {closed.length} closed (postmortem below)</>}{" "}
          · tap a tile to open its detail page for pricing, staffing, and
          marketing controls.
        </p>
      </header>

      {tabs.length > 1 && (
        <nav
          className="flex gap-1 border-b border-ink-800 -mx-1 px-1"
          aria-label="Portfolio sections"
        >
          {tabs.map((t) => {
            const active = t === tab;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={
                  "text-sm px-3 py-2 border-b-2 transition-colors whitespace-nowrap " +
                  (active
                    ? "border-accent text-ink-50"
                    : "border-transparent text-ink-400 hover:text-ink-100")
                }
                aria-current={active ? "page" : undefined}
              >
                {t === "active"
                  ? `Active (${bizs.length})`
                  : `Closed (${closed.length})`}
              </button>
            );
          })}
        </nav>
      )}

      {tab === "active" && <ActiveGrid game={game} bizs={bizs} />}
      {tab === "closed" && <GraveyardList game={game} closed={closed} />}
    </div>
  );
}

function ActiveGrid({
  game,
  bizs,
}: {
  game: ReturnType<typeof useGameStore.getState>["game"];
  bizs: Business[];
}) {
  if (!game) return null;
  if (bizs.length === 0) {
    return (
      <Card>
        <p className="text-sm text-ink-300">
          No active businesses. Your postmortems are on the{" "}
          <span className="font-semibold">Closed</span> tab, and the{" "}
          <Link to="/market" className="text-accent underline">
            Market
          </Link>{" "}
          has spaces ready for a fresh start.
        </p>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {bizs.map((biz) => {
        const marketName = game.markets[biz.locationId]?.name ?? "—";
        const csat = biz.kpis.customerSatisfaction;
        const csatTone =
          csat >= 85
            ? "text-money"
            : csat >= 70
              ? "text-ink-100"
              : "text-loss";
        const profit = biz.kpis.weeklyProfit;
        const profitTone =
          profit > 0 ? "text-money" : profit < 0 ? "text-loss" : "text-ink-200";
        const occupancy = biz.propertyId
          ? "🏢 Owned"
          : (biz.state as unknown as { rentMonthly?: number }).rentMonthly
            ? "🏠 Rented"
            : "—";
        const status = biz.status ?? "operating";
        const weeks = biz.insolvencyWeeks ?? 0;
        const statusBadge =
          status === "insolvent"
            ? {
                text: "INSOLVENT",
                tone: "bg-loss/20 text-loss border-loss/50",
                hint: "Forced liquidation on next weekly tick",
              }
            : status === "distressed"
              ? {
                  text: `DISTRESSED ${weeks}/4`,
                  tone: "bg-amber-900/40 text-amber-200 border-amber-700/60",
                  hint: `Week ${weeks} of 4 underwater`,
                }
              : null;
        return (
          <Link
            key={biz.id}
            to={`/business/${biz.id}`}
            className={
              "block rounded-2xl border bg-ink-900/70 shadow-card p-4 hover:bg-ink-900 transition " +
              (status === "insolvent"
                ? "border-loss/50 hover:border-loss"
                : status === "distressed"
                  ? "border-amber-700/50 hover:border-amber-500"
                  : "border-ink-800 hover:border-accent/60")
            }
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-ink-50 truncate">
                  {TYPE_ICON[biz.type] ?? "🏢"} {biz.name}
                </h3>
                <p className="text-xs text-ink-400 truncate">
                  {marketName} · {bizSubtitle(biz)}
                </p>
              </div>
              <span className="text-[11px] text-ink-500 shrink-0">
                {occupancy}
              </span>
            </div>

            {statusBadge && (
              <div
                className={`mb-2 inline-block text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide font-semibold ${statusBadge.tone}`}
                title={statusBadge.hint}
              >
                {statusBadge.text}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-ink-500 uppercase tracking-wide text-[10px]">
                  Weekly profit
                </div>
                <div
                  className={`font-mono tabular-nums text-sm ${profitTone}`}
                >
                  {formatMoney(profit, { compact: true, sign: true })}
                </div>
              </div>
              <div>
                <div className="text-ink-500 uppercase tracking-wide text-[10px]">
                  CSAT
                </div>
                <div className={`font-mono tabular-nums text-sm ${csatTone}`}>
                  {csat.toFixed(0)}
                </div>
              </div>
              <div>
                <div className="text-ink-500 uppercase tracking-wide text-[10px]">
                  {biz.type === "corner_store" ? "Stock" : "Ambience"}
                </div>
                <div className="font-mono tabular-nums text-sm text-ink-200">
                  {biz.type === "corner_store"
                    ? `${Math.round(biz.derived.stockLevel * 100)}%`
                    : `${Math.round(((biz.state as unknown as { ambience?: number }).ambience ?? 0) * 100)}%`}
                </div>
              </div>
            </div>

            <div className="mt-3 text-[11px] text-accent">
              Open detail →
            </div>
          </Link>
        );
      })}
    </div>
  );
}

const REASON_LABEL: Record<ClosedBusinessRecord["closedReason"], string> = {
  liquidation: "Forced liquidation",
  voluntary_close: "Voluntary close",
  hosted_property_sold: "Property sold out from under",
};

const REASON_TONE: Record<ClosedBusinessRecord["closedReason"], string> = {
  liquidation: "text-loss",
  voluntary_close: "text-amber-300",
  hosted_property_sold: "text-ink-300",
};

function GraveyardList({
  game,
  closed,
}: {
  game: ReturnType<typeof useGameStore.getState>["game"];
  closed: ClosedBusinessRecord[];
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (!game) return null;
  // Newest first.
  const ordered = [...closed].sort((a, b) => b.closedAtTick - a.closedAtTick);
  const totalUnsecuredFromLoans = ordered.reduce(
    (a, r) => a + r.unsecuredDebtFromLoanCents,
    0,
  );
  const totalCreditHit = ordered.reduce((a, r) => a + r.creditImpact, 0);

  return (
    <div className="space-y-4">
      <Card
        title="Dynasty closure totals"
        subtitle={`${ordered.length} closed across all generations`}
      >
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-ink-500 uppercase tracking-wide text-[10px]">
              Closed
            </div>
            <div className="font-mono tabular-nums text-lg text-ink-50">
              {ordered.length}
            </div>
          </div>
          <div>
            <div className="text-ink-500 uppercase tracking-wide text-[10px]">
              Loans → personal
            </div>
            <div
              className={
                "font-mono tabular-nums text-lg " +
                (totalUnsecuredFromLoans > 0 ? "text-loss" : "text-ink-300")
              }
            >
              {formatMoney(totalUnsecuredFromLoans, { compact: true })}
            </div>
          </div>
          <div>
            <div className="text-ink-500 uppercase tracking-wide text-[10px]">
              Total credit hit
            </div>
            <div className="font-mono tabular-nums text-lg text-loss">
              {totalCreditHit}
            </div>
          </div>
        </div>
      </Card>

      <ul className="space-y-3">
        {ordered.map((r) => {
          const mod = safeModule(r.type);
          const marketName = game.markets[r.marketId]?.name ?? r.marketId;
          const isOpen = !!expanded[r.id];
          return (
            <li
              key={r.id}
              className="rounded-2xl border border-ink-800 bg-ink-900/60 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-ink-100 truncate">
                    {mod?.ui.icon ?? "🪦"} {r.name}
                  </h3>
                  <p className="text-xs text-ink-400">
                    {mod?.ui.label ?? r.type} · {marketName} · opened{" "}
                    {formatGameDate(r.openedAtTick, "short")} → closed{" "}
                    {formatGameDate(r.closedAtTick, "short")}
                  </p>
                </div>
                <div
                  className={`text-[11px] uppercase tracking-wide font-semibold shrink-0 ${REASON_TONE[r.closedReason]}`}
                >
                  {REASON_LABEL[r.closedReason]}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div>
                  <div className="text-ink-500 uppercase tracking-wide text-[10px]">
                    Peak weekly revenue
                  </div>
                  <div className="font-mono tabular-nums text-ink-100">
                    {formatMoney(r.peakWeeklyRevenueCents, { compact: true })}
                  </div>
                </div>
                <div>
                  <div className="text-ink-500 uppercase tracking-wide text-[10px]">
                    Proceeds recovered
                  </div>
                  <div className="font-mono tabular-nums text-money">
                    {formatMoney(r.liquidationProceedsCents, { compact: true })}
                  </div>
                </div>
                <div>
                  <div className="text-ink-500 uppercase tracking-wide text-[10px]">
                    Loans → personal
                  </div>
                  <div
                    className={
                      "font-mono tabular-nums " +
                      (r.unsecuredDebtFromLoanCents > 0
                        ? "text-loss"
                        : "text-ink-300")
                    }
                  >
                    {formatMoney(r.unsecuredDebtFromLoanCents, { compact: true })}
                  </div>
                </div>
                <div>
                  <div className="text-ink-500 uppercase tracking-wide text-[10px]">
                    Credit hit
                  </div>
                  <div className="font-mono tabular-nums text-loss">
                    {r.creditImpact}
                  </div>
                </div>
              </div>
              {isOpen && (
                <div className="mt-3 text-[11px] text-ink-400 border-t border-ink-800 pt-2 space-y-1">
                  <div>
                    Final cash before close:{" "}
                    <span
                      className={
                        "font-mono " +
                        (r.finalCashCents < 0 ? "text-loss" : "text-ink-200")
                      }
                    >
                      {formatMoney(r.finalCashCents, { compact: true, sign: true })}
                    </span>
                  </div>
                  <div>
                    Closed reason:{" "}
                    <span className={REASON_TONE[r.closedReason]}>
                      {REASON_LABEL[r.closedReason]}
                    </span>{" "}
                    —{" "}
                    {r.closedReason === "liquidation"
                      ? "4 consecutive weeks underwater triggered forced sale at 40% of book."
                      : r.closedReason === "voluntary_close"
                        ? "Player pressed Close Now before the 4-week buzzer; 60% of book recovered."
                        : "Player sold the building out from under a hosted business."}
                  </div>
                  <div>
                    Book value (from registry):{" "}
                    <span className="font-mono text-ink-200">
                      {mod
                        ? formatMoney(mod.startup.startupCostCents, {
                            compact: true,
                          })
                        : "—"}
                    </span>
                  </div>
                </div>
              )}
              <div className="mt-3">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [r.id]: !prev[r.id] }))
                  }
                >
                  {isOpen ? "Hide details" : "Show details"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function safeModule(type: BusinessTypeId) {
  try {
    return getBusinessModule(type);
  } catch {
    // If a future save carries a closed record of a type no longer in the
    // registry (unlikely but possible), fail soft.
    return undefined;
  }
}
