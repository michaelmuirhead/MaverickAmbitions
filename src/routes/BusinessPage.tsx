import { Link } from "react-router-dom";

import { Card } from "@/components/ui/Card";

import { useGameStore } from "@/state/store";
import { selectPlayerBusinesses } from "@/state/selectors";
import { formatMoney } from "@/lib/money";

import type { Business, BusinessTypeId } from "@/types/game";

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

export function BusinessPage() {
  const game = useGameStore((s) => s.game)!;
  const bizs = selectPlayerBusinesses(game);

  if (bizs.length === 0) {
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

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Your businesses</h1>
        <p className="text-sm text-ink-400 mt-1">
          {bizs.length} active · tap a tile to open its detail page for
          pricing, staffing, and marketing controls.
        </p>
      </header>

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
          return (
            <Link
              key={biz.id}
              to={`/business/${biz.id}`}
              className="block rounded-2xl border border-ink-800 bg-ink-900/70 shadow-card p-4 hover:border-accent/60 hover:bg-ink-900 transition"
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
    </div>
  );
}
