/**
 * Per-business detail page (v0.7 Player Agency).
 *
 * Route: `/business/:id` (HashRouter).
 *
 * Five tabs — Overview / Inventory / Staff / Marketing / Finance — each
 * wired to the existing `patchBusinessState` store action so UI edits
 * apply immediately and survive ticks (the engine reads fresh state at
 * the top of every `onHour/onDay/onWeek`).
 *
 * The page holds NO simulation state of its own — everything lives on
 * `biz.state` in the store. Local component state is only used for UI
 * concerns like "which tab is open" and the ephemeral applicant pool
 * (regenerated from a seed + nonce, never persisted).
 */

import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatTile } from "@/components/ui/StatTile";

import { useGameStore } from "@/state/store";
import { formatMoney } from "@/lib/money";
import { createRng } from "@/lib/rng";
import { pickName } from "@/data/names";

import type { Business, LedgerEntry } from "@/types/game";

import type { CornerStoreState } from "@/engine/business/retail";
import type { CafeState, CafeQualityTier } from "@/engine/business/cafe";
import type { BarState } from "@/engine/business/bar";
import type { RestaurantState } from "@/engine/business/restaurant";
import type { LiquorTier, MenuProgram } from "@/engine/business/hospitality";
import { priceAttractiveness } from "@/engine/economy/market";
import { haloContribution } from "@/engine/economy/reputation";
import { ECONOMY } from "@/engine/economy/constants";
import { SKU_LABELS } from "@/data/items";
import { MENU_LABELS } from "@/data/menu";
import { DRINK_LABELS } from "@/data/barDrinks";
import { DISH_LABELS } from "@/data/restaurantMenu";

type TabKey = "overview" | "inventory" | "staff" | "marketing" | "finance";

const TAB_LABELS: Record<TabKey, string> = {
  overview: "Overview",
  inventory: "Inventory",
  staff: "Staff",
  marketing: "Marketing",
  finance: "Finance",
};

export function BusinessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const game = useGameStore((s) => s.game)!;
  const patchBiz = useGameStore((s) => s.patchBusinessState);
  const [tab, setTab] = useState<TabKey>("overview");

  const biz = id ? game.businesses[id] : undefined;

  if (!biz || biz.ownerId !== game.player.id) {
    // Either the id is bogus, or the player doesn't own it (rival biz, closed).
    return <Navigate to="/business" replace />;
  }

  const onPatch = (patch: Partial<Business["state"]>) => patchBiz(biz.id, patch);
  const marketName = game.markets[biz.locationId]?.name ?? biz.locationId;

  // Corner-store has no separate inventory tab label; every type uses the same 5 tabs.
  const tabs: TabKey[] = ["overview", "inventory", "staff", "marketing", "finance"];

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Link
          to="/business"
          className="text-ink-400 hover:text-ink-100 text-sm"
          aria-label="Back to businesses"
        >
          ← All businesses
        </Link>
      </header>

      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <span>{bizIcon(biz.type)}</span>
          <span className="truncate">{biz.name}</span>
        </h1>
        <p className="text-sm text-ink-400 mt-1">
          {bizLabel(biz.type)} · {marketName} · opened tick{" "}
          {biz.openedAtTick.toLocaleString()}
        </p>
      </div>

      <nav
        className="flex gap-1 overflow-x-auto border-b border-ink-800 -mx-1 px-1"
        aria-label="Business sections"
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
              {TAB_LABELS[t]}
            </button>
          );
        })}
      </nav>

      {tab === "overview" && <OverviewTab biz={biz} onPatch={onPatch} marketName={marketName} />}
      {tab === "inventory" && <InventoryTab biz={biz} onPatch={onPatch} />}
      {tab === "staff" && <StaffTab biz={biz} onPatch={onPatch} />}
      {tab === "marketing" && <MarketingTab biz={biz} onPatch={onPatch} />}
      {tab === "finance" && <FinanceTab biz={biz} />}
    </div>
  );
}

// ===== Helpers =====

function bizIcon(type: Business["type"]): string {
  switch (type) {
    case "corner_store":
      return "🏪";
    case "cafe":
      return "☕";
    case "bar":
      return "🍻";
    case "restaurant":
      return "🍽️";
    default:
      return "🏢";
  }
}

function bizLabel(type: Business["type"]): string {
  switch (type) {
    case "corner_store":
      return "Corner Store";
    case "cafe":
      return "Cafe";
    case "bar":
      return "Bar";
    case "restaurant":
      return "Restaurant";
    default:
      return type;
  }
}

// ===== Overview tab =====

function OverviewTab({
  biz,
  onPatch,
  marketName,
}: {
  biz: Business;
  onPatch: (patch: Partial<Business["state"]>) => void;
  marketName: string;
}) {
  const csat = biz.kpis.customerSatisfaction;
  const csatTone =
    csat >= 85 ? "text-money" : csat >= 70 ? "text-ink-100" : "text-loss";

  const haloSelf =
    biz.type === "cafe" || biz.type === "bar" || biz.type === "restaurant"
      ? haloContribution(csat, biz.type)
      : 0;

  const marginPct =
    biz.kpis.weeklyRevenue > 0
      ? (biz.kpis.weeklyProfit / biz.kpis.weeklyRevenue) * 100
      : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label="Weekly revenue"
          value={formatMoney(biz.kpis.weeklyRevenue, { compact: true })}
        />
        <StatTile
          label="Weekly profit"
          value={formatMoney(biz.kpis.weeklyProfit, { compact: true, sign: true })}
          delta={marginPct}
        />
        <StatTile
          label={biz.type === "corner_store" ? "Customer satisfaction" : "CSAT"}
          value={<span className={csatTone}>{csat.toFixed(0)}</span>}
        />
        <StatTile
          label={biz.type === "corner_store" ? "Stock level" : "Prep stock"}
          value={`${Math.round(biz.derived.stockLevel * 100)}%`}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label="Business cash"
          value={formatMoney(biz.cash, { compact: true })}
          hint="Operating float on-hand"
        />
        <StatTile
          label="Risk score"
          value={biz.derived.riskScore.toFixed(0)}
          hint={biz.derived.riskScore >= 50 ? "Elevated — audit/compliance watch" : "OK"}
        />
        {haloSelf > 0 && (
          <StatTile
            label="Halo contribution"
            value={`+${(haloSelf * 100).toFixed(0)}%`}
            hint={`Bumps every biz you own in ${marketName}`}
          />
        )}
        <StatTile
          label="Pending wages"
          value={formatMoney(biz.derived.pendingWages, { compact: true })}
          hint="Paid on week close"
        />
      </div>

      {biz.type === "cafe" && (
        <CafeQualityTierCard biz={biz} onPatch={onPatch} />
      )}
      {biz.type === "bar" && <BarTierCard biz={biz} onPatch={onPatch} />}
      {biz.type === "restaurant" && (
        <RestaurantProgramCard biz={biz} onPatch={onPatch} />
      )}

      <Card title="About this business" subtitle={`${bizLabel(biz.type)} · ${marketName}`}>
        <p className="text-xs text-ink-400">{bizBlurb(biz.type)}</p>
      </Card>
    </div>
  );
}

function bizBlurb(type: Business["type"]): string {
  switch (type) {
    case "corner_store":
      return "Throughput + price. Keep shelves stocked, undercut rivals on staples, watch the 24-hour demand curve.";
    case "cafe":
      return "Reputation flywheel. High CSAT radiates a traffic halo to every other business you own in this market.";
    case "bar":
      return "Late peaks (10pm–12am). Happy hour lifts slow slots at the cost of margin. Keep ID-checks diligent.";
    case "restaurant":
      return "Covers-per-seat game. Reservations steady demand; blockbuster nights come from walk-ins.";
    default:
      return "";
  }
}

// --- Type-specific Overview sub-cards ---

const CAFE_TIER_LABELS: Record<CafeQualityTier, string> = {
  basic: "Basic",
  craft: "Craft",
  premium: "Premium",
};

function CafeQualityTierCard({
  biz,
  onPatch,
}: {
  biz: Business;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  const st = biz.state as unknown as CafeState;
  return (
    <Card
      title="Quality tier"
      subtitle="Raises CSAT ceiling + price — at a cost."
    >
      <div className="flex flex-wrap gap-2">
        {(["basic", "craft", "premium"] as CafeQualityTier[]).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={st.qualityTier === t ? "primary" : "secondary"}
            onClick={() => onPatch({ qualityTier: t })}
          >
            {CAFE_TIER_LABELS[t]}
          </Button>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({ ambience: Math.min(1, (st.ambience ?? 0) + 0.2) })
          }
          title="Capex pulse: +20% ambience"
        >
          Refresh ambience ({Math.round(st.ambience * 100)}%)
        </Button>
      </div>
    </Card>
  );
}

const LIQUOR_LABELS: Record<LiquorTier, string> = {
  well: "Well",
  call: "Call",
  top_shelf: "Top Shelf",
};

function BarTierCard({
  biz,
  onPatch,
}: {
  biz: Business;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  const st = biz.state as unknown as BarState;
  return (
    <Card
      title="Operations"
      subtitle={`Liquor shelf · Happy hour · ID checks`}
    >
      <div className="text-[11px] uppercase tracking-wide text-ink-400 mb-1">
        Liquor shelf
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {(["well", "call", "top_shelf"] as LiquorTier[]).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={st.liquorTier === t ? "primary" : "secondary"}
            onClick={() => onPatch({ liquorTier: t })}
          >
            {LIQUOR_LABELS[t]}
          </Button>
        ))}
      </div>

      <div className="text-[11px] uppercase tracking-wide text-ink-400 mb-1">
        Happy hour {st.happyHour.enabled ? "· ON" : "· off"}
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <Button
          size="sm"
          variant={st.happyHour.enabled ? "primary" : "secondary"}
          onClick={() =>
            onPatch({
              happyHour: { ...st.happyHour, enabled: !st.happyHour.enabled },
            })
          }
        >
          Toggle {st.happyHour.startHour}:00–{st.happyHour.endHour}:00
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({ idCheckDiligence: Math.min(1, st.idCheckDiligence + 0.1) })
          }
          title={`ID-check diligence ${(st.idCheckDiligence * 100).toFixed(0)}%`}
        >
          + ID checks ({Math.round(st.idCheckDiligence * 100)}%)
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({ ambience: Math.min(1, (st.ambience ?? 0) + 0.2) })
          }
        >
          Refresh ambience ({Math.round(st.ambience * 100)}%)
        </Button>
      </div>
    </Card>
  );
}

const PROGRAM_LABELS: Record<MenuProgram, string> = {
  diner: "Diner",
  bistro: "Bistro",
  chef_driven: "Chef-Driven",
};

function RestaurantProgramCard({
  biz,
  onPatch,
}: {
  biz: Business;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  const st = biz.state as unknown as RestaurantState;
  return (
    <Card title="Menu program + reservations">
      <div className="text-[11px] uppercase tracking-wide text-ink-400 mb-1">
        Program
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {(["diner", "bistro", "chef_driven"] as MenuProgram[]).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={st.program === t ? "primary" : "secondary"}
            onClick={() => onPatch({ program: t })}
          >
            {PROGRAM_LABELS[t]}
          </Button>
        ))}
      </div>

      <div className="text-[11px] uppercase tracking-wide text-ink-400 mb-1">
        Reservation density · {Math.round(st.reservationDensity * 100)}%
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({
              reservationDensity: Math.max(0, st.reservationDensity - 0.1),
            })
          }
        >
          − 10%
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({
              reservationDensity: Math.min(1, st.reservationDensity + 0.1),
            })
          }
        >
          + 10%
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onPatch({ ticksSinceMenuRefresh: 0 })}
          title="Seasonal refresh resets staleness timer."
        >
          Refresh menu
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({ ambience: Math.min(1, (st.ambience ?? 0) + 0.2) })
          }
        >
          Refresh ambience ({Math.round(st.ambience * 100)}%)
        </Button>
      </div>
    </Card>
  );
}

// ===== Inventory tab =====

function InventoryTab({
  biz,
  onPatch,
}: {
  biz: Business;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  if (biz.type === "corner_store") {
    return <CornerStoreInventory biz={biz} onPatch={onPatch} />;
  }
  if (biz.type === "cafe") return <CafeInventory biz={biz} onPatch={onPatch} />;
  if (biz.type === "bar") return <BarInventory biz={biz} onPatch={onPatch} />;
  if (biz.type === "restaurant") return <RestaurantInventory biz={biz} onPatch={onPatch} />;
  return (
    <Card>
      <p className="text-xs text-ink-400">No inventory for this business type.</p>
    </Card>
  );
}

/**
 * 5% increment pricing slider around `referencePrice`. Range [-30%, +50%].
 * Shows margin and a traffic elasticity preview from `priceAttractiveness`.
 */
function PricingRow({
  itemLabel,
  cost,
  price,
  referencePrice,
  stock,
  onSetPrice,
}: {
  itemLabel: string;
  cost: number;
  price: number;
  referencePrice: number;
  stock?: number | string;
  onSetPrice: (newPriceCents: number) => void;
}) {
  // Snap to 5% of reference price.
  const step = Math.max(1, Math.round(referencePrice * 0.05));
  const minPrice = Math.max(1, Math.round(referencePrice * 0.7));
  const maxPrice = Math.round(referencePrice * 1.5);
  const clamped = Math.min(maxPrice, Math.max(minPrice, price));
  const ratio = clamped / Math.max(1, referencePrice);
  const elasticity = priceAttractiveness(ratio); // 0.2 .. 1.5
  const unitMarginCents = clamped - cost;
  const unitMarginPct = clamped > 0 ? (unitMarginCents / clamped) * 100 : 0;

  const elasticityTone =
    elasticity >= 1.1 ? "text-money" : elasticity >= 0.8 ? "text-ink-100" : "text-loss";

  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-ink-50 truncate">{itemLabel}</div>
          <div className="text-xs text-ink-400">
            Cost {formatMoney(cost)} · Ref {formatMoney(referencePrice)}
            {stock !== undefined ? ` · Stock ${stock}` : ""}
          </div>
        </div>
        <div className="text-right font-mono tabular-nums text-sm text-ink-50">
          {formatMoney(clamped)}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="range"
          min={minPrice}
          max={maxPrice}
          step={step}
          value={clamped}
          onChange={(e) => onSetPrice(Number(e.target.value))}
          className="flex-1 accent-amber-400"
          aria-label={`Price for ${itemLabel}`}
        />
        <button
          className="text-[11px] text-ink-400 hover:text-ink-100 underline"
          onClick={() => onSetPrice(referencePrice)}
          type="button"
        >
          Reset
        </button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-ink-400">Margin</div>
          <div
            className={
              unitMarginCents > 0
                ? "text-money font-mono"
                : unitMarginCents < 0
                  ? "text-loss font-mono"
                  : "text-ink-200 font-mono"
            }
          >
            {formatMoney(unitMarginCents, { sign: true })}{" "}
            <span className="text-ink-400">({unitMarginPct.toFixed(0)}%)</span>
          </div>
        </div>
        <div>
          <div className="text-ink-400">vs reference</div>
          <div className="text-ink-100 font-mono">
            {((ratio - 1) * 100 >= 0 ? "+" : "") + ((ratio - 1) * 100).toFixed(0)}%
          </div>
        </div>
        <div>
          <div className="text-ink-400">Traffic pull</div>
          <div className={`font-mono ${elasticityTone}`}>
            ×{elasticity.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}

function CornerStoreInventory({
  biz,
  onPatch,
}: {
  biz: Business;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  const st = biz.state as unknown as CornerStoreState;
  const skuList = Object.values(st.skus);
  return (
    <Card title="Inventory" subtitle={`${skuList.length} SKUs · 5% increments around reference`}>
      <div className="flex flex-col gap-3">
        {skuList.map((sku) => (
          <PricingRow
            key={sku.skuId}
            itemLabel={SKU_LABELS[sku.skuId] ?? sku.skuId}
            cost={sku.cost}
            price={sku.price}
            referencePrice={sku.referencePrice}
            stock={sku.stock}
            onSetPrice={(p) =>
              onPatch({
                skus: {
                  ...st.skus,
                  [sku.skuId]: { ...sku, price: p },
                },
              } as Partial<Business["state"]>)
            }
          />
        ))}
      </div>
    </Card>
  );
}

function CafeInventory({
  biz,
  onPatch,
}: {
  biz: Business;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  const st = biz.state as unknown as CafeState;
  return (
    <Card title="Menu" subtitle={`${Object.keys(st.menu).length} items · 5% increments around reference`}>
      <div className="flex flex-col gap-3">
        {Object.values(st.menu).map((m) => (
          <PricingRow
            key={m.id}
            itemLabel={MENU_LABELS[m.id] ?? m.id}
            cost={m.cost}
            price={m.price}
            referencePrice={m.referencePrice}
            stock={`${m.stock}/${m.dailyPar}`}
            onSetPrice={(p) =>
              onPatch({
                menu: {
                  ...st.menu,
                  [m.id]: { ...m, price: p },
                },
              } as Partial<Business["state"]>)
            }
          />
        ))}
      </div>
    </Card>
  );
}

function BarInventory({
  biz,
  onPatch,
}: {
  biz: Business;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  const st = biz.state as unknown as BarState;
  return (
    <Card title="Drink list" subtitle={`${Object.keys(st.menu).length} pours · happy-hour eligible items marked HH`}>
      <div className="flex flex-col gap-3">
        {Object.values(st.menu).map((d) => (
          <PricingRow
            key={d.id}
            itemLabel={
              (DRINK_LABELS[d.id] ?? d.id) +
              (d.happyHourEligible ? " · HH" : "")
            }
            cost={d.cost}
            price={d.price}
            referencePrice={d.referencePrice}
            onSetPrice={(p) =>
              onPatch({
                menu: {
                  ...st.menu,
                  [d.id]: { ...d, price: p },
                },
              } as Partial<Business["state"]>)
            }
          />
        ))}
      </div>
    </Card>
  );
}

function RestaurantInventory({
  biz,
  onPatch,
}: {
  biz: Business;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  const st = biz.state as unknown as RestaurantState;
  return (
    <Card title="Menu" subtitle={`${Object.keys(st.menu).length} dishes · 5% increments around reference`}>
      <div className="flex flex-col gap-3">
        {Object.values(st.menu).map((m) => (
          <PricingRow
            key={m.id}
            itemLabel={DISH_LABELS[m.id] ?? m.id}
            cost={m.cost}
            price={m.price}
            referencePrice={m.referencePrice}
            onSetPrice={(p) =>
              onPatch({
                menu: {
                  ...st.menu,
                  [m.id]: { ...m, price: p },
                },
              } as Partial<Business["state"]>)
            }
          />
        ))}
      </div>
    </Card>
  );
}

// ===== Staff tab =====

/** A staff record normalized across biz types for the roster UI. */
interface RosterStaff {
  id: string;
  name: string;
  hourlyWageCents: number;
  aptitude: number; // skill or craft (0..100)
  aptitudeLabel: "Skill" | "Craft";
  morale: number;
}

interface RosterView {
  sections: RosterSection[];
  /** Wage band for hiring (hourly, cents). Different by biz/role. */
  defaultHourlyBand: number;
}

interface RosterSection {
  /** "Clerks", "Baristas", "Bartenders", "Cooks", "Servers"… */
  label: string;
  /** The key on biz.state whose array this section maps to. */
  stateKey: string;
  /** Entries in that array, normalized. */
  people: RosterStaff[];
  /** Which aptitude field the underlying records use. */
  aptitudeField: "skill" | "craft";
  /** Baseline wage used for hiring suggestions (hourly, cents). */
  hourlyBand: number;
}

function buildRoster(biz: Business): RosterView {
  if (biz.type === "corner_store") {
    const st = biz.state as unknown as CornerStoreState;
    return {
      defaultHourlyBand: ECONOMY.BASE_HOURLY_WAGE_CENTS,
      sections: [
        {
          label: "Clerks",
          stateKey: "staff",
          aptitudeField: "skill",
          hourlyBand: ECONOMY.BASE_HOURLY_WAGE_CENTS,
          people: st.staff.map((p) => ({
            id: p.id,
            name: p.name,
            hourlyWageCents: p.hourlyWageCents,
            aptitude: p.skill,
            aptitudeLabel: "Skill",
            morale: p.morale,
          })),
        },
      ],
    };
  }
  if (biz.type === "cafe") {
    const st = biz.state as unknown as CafeState;
    const band = avg(st.baristas.map((b) => b.hourlyWageCents), ECONOMY.BASE_HOURLY_WAGE_CENTS);
    return {
      defaultHourlyBand: band,
      sections: [
        {
          label: "Baristas",
          stateKey: "baristas",
          aptitudeField: "craft",
          hourlyBand: band,
          people: st.baristas.map((p) => ({
            id: p.id,
            name: p.name,
            hourlyWageCents: p.hourlyWageCents,
            aptitude: p.craft,
            aptitudeLabel: "Craft",
            morale: p.morale,
          })),
        },
      ],
    };
  }
  if (biz.type === "bar") {
    const st = biz.state as unknown as BarState;
    const band = avg(st.bartenders.map((b) => b.hourlyWageCents), ECONOMY.BASE_HOURLY_WAGE_CENTS);
    return {
      defaultHourlyBand: band,
      sections: [
        {
          label: "Bartenders",
          stateKey: "bartenders",
          aptitudeField: "craft",
          hourlyBand: band,
          people: st.bartenders.map((p) => ({
            id: p.id,
            name: p.name,
            hourlyWageCents: p.hourlyWageCents,
            aptitude: p.craft,
            aptitudeLabel: "Craft",
            morale: p.morale,
          })),
        },
      ],
    };
  }
  if (biz.type === "restaurant") {
    const st = biz.state as unknown as RestaurantState;
    const cooksBand = avg(st.cooks.map((b) => b.hourlyWageCents), ECONOMY.BASE_HOURLY_WAGE_CENTS);
    const serversBand = avg(st.servers.map((b) => b.hourlyWageCents), Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 0.85));
    return {
      defaultHourlyBand: cooksBand,
      sections: [
        {
          label: "Line cooks",
          stateKey: "cooks",
          aptitudeField: "craft",
          hourlyBand: cooksBand,
          people: st.cooks.map((p) => ({
            id: p.id,
            name: p.name,
            hourlyWageCents: p.hourlyWageCents,
            aptitude: p.craft,
            aptitudeLabel: "Craft",
            morale: p.morale,
          })),
        },
        {
          label: "Servers",
          stateKey: "servers",
          aptitudeField: "craft",
          hourlyBand: serversBand,
          people: st.servers.map((p) => ({
            id: p.id,
            name: p.name,
            hourlyWageCents: p.hourlyWageCents,
            aptitude: p.craft,
            aptitudeLabel: "Craft",
            morale: p.morale,
          })),
        },
      ],
    };
  }
  return { sections: [], defaultHourlyBand: ECONOMY.BASE_HOURLY_WAGE_CENTS };
}

function avg(xs: number[], fallback: number): number {
  if (xs.length === 0) return fallback;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/** Synthetic applicant from the hiring pool. */
interface Applicant {
  id: string;
  name: string;
  aptitude: number;
  askedWageCents: number;
}

function makeApplicants(
  seed: string,
  nonce: number,
  hourlyBand: number,
  n = 4,
): Applicant[] {
  const rng = createRng(`${seed}:applicants:${nonce}`);
  const out: Applicant[] = [];
  for (let i = 0; i < n; i++) {
    const apt = Math.round(rng.nextFloat(30, 85));
    // Higher aptitude asks for more money; wages sit at 80%..130% of band.
    const factor = 0.8 + (apt - 30) / 55 * 0.5 + rng.nextFloat(-0.08, 0.08);
    const wage = Math.max(
      Math.round(hourlyBand * 0.75),
      Math.round(hourlyBand * factor),
    );
    out.push({
      id: `app-${nonce}-${i}`,
      name: pickName(rng),
      aptitude: apt,
      askedWageCents: wage,
    });
  }
  return out;
}

function StaffTab({
  biz,
  onPatch,
}: {
  biz: Business;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  const roster = useMemo(() => buildRoster(biz), [biz]);
  const [nonce, setNonce] = useState(0);
  const [section, setSection] = useState<string>(
    roster.sections[0]?.label ?? "",
  );
  const activeSection =
    roster.sections.find((s) => s.label === section) ?? roster.sections[0];

  const band = activeSection?.hourlyBand ?? roster.defaultHourlyBand;
  const applicants = useMemo(
    () => makeApplicants(`${biz.id}:${activeSection?.stateKey ?? ""}`, nonce, band),
    [biz.id, activeSection?.stateKey, nonce, band],
  );

  if (!activeSection) {
    return (
      <Card>
        <p className="text-xs text-ink-400">No roster sections for this business type.</p>
      </Card>
    );
  }

  const hire = (a: Applicant) => {
    const hiredRecord = buildStaffRecord(biz, activeSection, a);
    const current = (biz.state as unknown as Record<string, unknown>)[
      activeSection.stateKey
    ] as unknown[];
    const nextArr = [...(current ?? []), hiredRecord];
    // Above-band hire = morale bump for the whole crew
    const wageRatio = a.askedWageCents / Math.max(1, band);
    const moraleBump = wageRatio > 1.1 ? 4 : 0;
    const bumped =
      moraleBump > 0
        ? nextArr.map((p) => {
            const pp = p as { morale?: number };
            if (typeof pp.morale === "number") {
              return { ...pp, morale: Math.min(100, pp.morale + moraleBump) };
            }
            return p;
          })
        : nextArr;
    onPatch({ [activeSection.stateKey]: bumped } as Partial<Business["state"]>);
    setNonce((n) => n + 1);
  };

  const fire = (personId: string) => {
    const current = (biz.state as unknown as Record<string, unknown>)[
      activeSection.stateKey
    ] as unknown[];
    // Remove, then ding morale on the rest (layoffs are a morale hit).
    const remaining = (current ?? []).filter(
      (p) => (p as { id: string }).id !== personId,
    );
    const punished = remaining.map((p) => {
      const pp = p as { morale?: number };
      if (typeof pp.morale === "number") {
        return { ...pp, morale: Math.max(0, pp.morale - 8) };
      }
      return p;
    });
    onPatch({ [activeSection.stateKey]: punished } as Partial<Business["state"]>);
  };

  const adjustWage = (personId: string, delta: number) => {
    const current = (biz.state as unknown as Record<string, unknown>)[
      activeSection.stateKey
    ] as unknown[];
    const updated = (current ?? []).map((p) => {
      const pp = p as { id: string; hourlyWageCents?: number; morale?: number };
      if (pp.id !== personId) return p;
      const nextWage = Math.max(500, (pp.hourlyWageCents ?? band) + delta);
      // Wage lifts above band boost morale; cuts below band ding it.
      const postRatio = nextWage / Math.max(1, band);
      const moraleShift = postRatio > 1.1 ? 3 : postRatio < 0.9 ? -5 : 0;
      return {
        ...pp,
        hourlyWageCents: nextWage,
        morale:
          typeof pp.morale === "number"
            ? Math.max(0, Math.min(100, pp.morale + moraleShift))
            : pp.morale,
      };
    });
    onPatch({ [activeSection.stateKey]: updated } as Partial<Business["state"]>);
  };

  return (
    <div className="space-y-4">
      {roster.sections.length > 1 && (
        <div className="flex gap-2">
          {roster.sections.map((s) => (
            <Button
              key={s.label}
              size="xs"
              variant={s.label === activeSection.label ? "primary" : "secondary"}
              onClick={() => setSection(s.label)}
            >
              {s.label} ({s.people.length})
            </Button>
          ))}
        </div>
      )}

      <Card
        title={`${activeSection.label} (${activeSection.people.length})`}
        subtitle={`Band ${formatMoney(band)}/hr · above-band lifts morale, layoffs ding it`}
      >
        {activeSection.people.length === 0 ? (
          <p className="text-xs text-ink-400">
            No one on this roster. Hire from the applicants below.
          </p>
        ) : (
          <ul className="divide-y divide-ink-800">
            {activeSection.people.map((p) => {
              const ratio = p.hourlyWageCents / Math.max(1, band);
              const wageTone =
                ratio > 1.1
                  ? "text-money"
                  : ratio < 0.9
                    ? "text-loss"
                    : "text-ink-300";
              return (
                <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-ink-50 truncate">{p.name}</div>
                    <div className="text-xs text-ink-400">
                      {p.aptitudeLabel} {p.aptitude.toFixed(0)} · Morale{" "}
                      {p.morale.toFixed(0)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => adjustWage(p.id, -100)}
                      className="text-xs px-2 py-1 rounded bg-ink-800 text-ink-200 hover:bg-ink-700"
                      aria-label="Decrease wage $1/hr"
                    >
                      −$1
                    </button>
                    <span className={`text-xs font-mono tabular-nums w-16 text-right ${wageTone}`}>
                      {formatMoney(p.hourlyWageCents)}/hr
                    </span>
                    <button
                      onClick={() => adjustWage(p.id, +100)}
                      className="text-xs px-2 py-1 rounded bg-ink-800 text-ink-200 hover:bg-ink-700"
                      aria-label="Increase wage $1/hr"
                    >
                      +$1
                    </button>
                    <Button
                      size="xs"
                      variant="danger"
                      onClick={() => fire(p.id)}
                      title="Fire — -8 morale for the remaining crew"
                    >
                      Fire
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title="Applicants"
        subtitle="Synthetic pool — refresh to re-roll"
        trailing={
          <Button size="xs" variant="secondary" onClick={() => setNonce((n) => n + 1)}>
            Refresh pool
          </Button>
        }
      >
        <ul className="divide-y divide-ink-800">
          {applicants.map((a) => {
            const ratio = a.askedWageCents / Math.max(1, band);
            const wageTone =
              ratio > 1.1
                ? "text-loss"
                : ratio < 0.95
                  ? "text-money"
                  : "text-ink-200";
            return (
              <li key={a.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-ink-50 truncate">{a.name}</div>
                  <div className="text-xs text-ink-400">
                    {activeSection.aptitudeField === "skill" ? "Skill" : "Craft"}{" "}
                    {a.aptitude} · asks{" "}
                    <span className={`font-mono ${wageTone}`}>
                      {formatMoney(a.askedWageCents)}/hr
                    </span>{" "}
                    <span className="text-ink-500">
                      ({((ratio - 1) * 100 >= 0 ? "+" : "") +
                        ((ratio - 1) * 100).toFixed(0)}%
                      {" vs band"})
                    </span>
                  </div>
                </div>
                <Button size="xs" variant="primary" onClick={() => hire(a)}>
                  Hire
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

/**
 * Build the concrete staff record for the section's array. Shape matches the
 * existing record type on each business module.
 */
function buildStaffRecord(
  biz: Business,
  section: RosterSection,
  app: Applicant,
): Record<string, unknown> {
  const base = {
    id: `${biz.id}-${section.stateKey}-${app.id}`,
    name: app.name,
    hourlyWageCents: app.askedWageCents,
    morale: 72,
  };
  if (section.aptitudeField === "skill") {
    return { ...base, skill: app.aptitude };
  }
  return { ...base, craft: app.aptitude };
}

// ===== Marketing tab =====

/**
 * Marketing budget slider. Writes `marketingWeekly` on the biz state. The
 * live `marketingScore` is what the sim actually reads for the traffic
 * multiplier; score decays 0.6× per week when no fresh spend lands.
 */
function MarketingTab({
  biz,
  onPatch,
}: {
  biz: Business;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  const st = biz.state as unknown as {
    marketingWeekly?: number;
    marketingScore?: number;
  };
  const weekly = st.marketingWeekly ?? 0;
  const score = st.marketingScore ?? 0;

  // Budget range: $0 .. $2,000/week in $50 steps.
  const min = 0;
  const max = 200_000;
  const step = 5_000;

  // Simulate decay curve for 8 weeks with current weekly as the "fresh spend"
  // influx. score_{t+1} = score_t * 0.6 + min(1, spend/$400) * 0.4  (matches
  // retail.ts onWeek math; cafe/bar/restaurant use similar shapes).
  const decayRef = biz.type === "corner_store" ? 40_000 : 50_000; // $400 / $500
  const decayMul = biz.type === "corner_store" ? 0.6 : 0.65;
  const steadyInflux = Math.min(1, weekly / Math.max(1, decayRef));
  const curve: number[] = [];
  let s = score;
  for (let i = 0; i < 8; i++) {
    s = s * decayMul + steadyInflux * (1 - decayMul);
    curve.push(s);
  }

  const bars = curve.map((v, i) => ({
    i,
    pct: Math.max(4, Math.round(v * 100)), // minimum bar height so 0 is still visible
  }));

  return (
    <div className="space-y-4">
      <Card
        title="Weekly marketing budget"
        subtitle="Fresh spend refreshes marketing score; no spend decays it."
      >
        <div className="flex items-end justify-between mb-1">
          <div className="text-3xl font-bold text-ink-50 font-mono tabular-nums">
            {formatMoney(weekly, { compact: true })}
          </div>
          <div className="text-xs text-ink-400">
            Score <span className="text-ink-100 font-mono">{(score * 100).toFixed(0)}%</span>
          </div>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={weekly}
          onChange={(e) => onPatch({ marketingWeekly: Number(e.target.value) } as Partial<Business["state"]>)}
          className="w-full accent-amber-400"
          aria-label="Weekly marketing budget"
        />
        <div className="flex justify-between text-[11px] text-ink-500 mt-1">
          <span>$0</span>
          <span>$500</span>
          <span>$1,000</span>
          <span>$1,500</span>
          <span>$2,000</span>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {[0, 10_000, 25_000, 50_000, 100_000].map((v) => (
            <Button
              key={v}
              size="xs"
              variant={weekly === v ? "primary" : "secondary"}
              onClick={() => onPatch({ marketingWeekly: v } as Partial<Business["state"]>)}
            >
              {v === 0 ? "Off" : formatMoney(v)}
            </Button>
          ))}
        </div>
      </Card>

      <Card
        title="Projected decay curve"
        subtitle="8-week forecast at current budget"
      >
        <div className="flex items-end gap-1 h-24">
          {bars.map((b) => (
            <div key={b.i} className="flex-1 flex flex-col items-center justify-end">
              <div
                className="w-full bg-amber-500/70 rounded-t"
                style={{ height: `${b.pct}%` }}
                title={`Week ${b.i + 1}: ${b.pct}%`}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-ink-500 mt-1">
          <span>+1w</span>
          <span>+4w</span>
          <span>+8w</span>
        </div>
        <p className="text-xs text-ink-400 mt-3">
          With a steady weekly budget of {formatMoney(weekly, { compact: true })},
          marketing score settles near{" "}
          <span className="font-mono text-ink-100">
            {Math.round((bars.at(-1)?.pct ?? 0))}%
          </span>
          . Going dark on marketing cuts it by ~
          {Math.round((1 - decayMul) * 100)}% every week.
        </p>
      </Card>
    </div>
  );
}

// ===== Finance tab =====

function FinanceTab({ biz }: { biz: Business }) {
  const game = useGameStore((s) => s.game)!;
  const ledger: LedgerEntry[] = useMemo(
    () =>
      game.ledger
        .filter((l) => l.businessId === biz.id)
        .slice(-30)
        .reverse(),
    [game.ledger, biz.id],
  );

  const loan = useMemo(() => {
    const loans = Object.values(game.businessLoans ?? {});
    return loans.find((l) => l.businessId === biz.id && l.balance > 0);
  }, [game.businessLoans, biz.id]);

  const marginPct =
    biz.kpis.weeklyRevenue > 0
      ? (biz.kpis.weeklyProfit / biz.kpis.weeklyRevenue) * 100
      : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label="Weekly revenue"
          value={formatMoney(biz.kpis.weeklyRevenue, { compact: true })}
        />
        <StatTile
          label="Weekly expenses"
          value={formatMoney(biz.kpis.weeklyExpenses, { compact: true })}
        />
        <StatTile
          label="Weekly profit"
          value={formatMoney(biz.kpis.weeklyProfit, { compact: true, sign: true })}
          delta={marginPct}
        />
        <StatTile
          label="Cash on hand"
          value={formatMoney(biz.cash, { compact: true })}
        />
      </div>

      {loan && (
        <Card
          title="Business loan"
          subtitle={`${(loan.annualRate * 100).toFixed(2)}% · ${loan.termMonths}mo · SBA-style, personally guaranteed`}
        >
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <div className="text-ink-400">Balance</div>
              <div className="text-ink-50 font-mono">
                {formatMoney(loan.balance, { compact: true })}
              </div>
            </div>
            <div>
              <div className="text-ink-400">Payment</div>
              <div className="text-ink-50 font-mono">
                {formatMoney(loan.monthlyPayment, { compact: true })}/mo
              </div>
            </div>
            <div>
              <div className="text-ink-400">Missed YTD</div>
              <div
                className={
                  (loan.missedPaymentsThisYear ?? 0) > 0 ? "text-loss" : "text-money"
                }
              >
                {loan.missedPaymentsThisYear ?? 0}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card title="Recent ledger" subtitle="Last 30 entries for this business">
        {ledger.length === 0 ? (
          <p className="text-xs text-ink-400">
            No ledger entries yet. Activity shows up after the first tick.
          </p>
        ) : (
          <ul className="divide-y divide-ink-800 text-xs">
            {ledger.map((e) => (
              <li
                key={e.id}
                className="py-1.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-ink-100 truncate">{e.memo}</div>
                  <div className="text-[10px] text-ink-500">
                    tick {e.tick} · {e.category}
                  </div>
                </div>
                <div
                  className={
                    "font-mono tabular-nums shrink-0 " +
                    (e.amount > 0
                      ? "text-money"
                      : e.amount < 0
                        ? "text-loss"
                        : "text-ink-300")
                  }
                >
                  {formatMoney(e.amount, { sign: true })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
