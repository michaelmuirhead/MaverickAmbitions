import type { ReactNode } from "react";

import { Link } from "react-router-dom";

import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { Button } from "@/components/ui/Button";

import { useGameStore } from "@/state/store";
import { selectPlayerBusinesses } from "@/state/selectors";
import { formatMoney } from "@/lib/money";

import type { Business } from "@/types/game";

import type { CornerStoreState } from "@/engine/business/retail";
import type { CafeState, CafeQualityTier } from "@/engine/business/cafe";
import type { BarState } from "@/engine/business/bar";
import type { RestaurantState } from "@/engine/business/restaurant";
import type { LiquorTier, MenuProgram } from "@/engine/business/hospitality";
import { haloContribution } from "@/engine/economy/reputation";
import { SKU_LABELS } from "@/data/items";
import { MENU_LABELS } from "@/data/menu";
import { DRINK_LABELS } from "@/data/barDrinks";
import { DISH_LABELS } from "@/data/restaurantMenu";

export function BusinessPage() {
  const game = useGameStore((s) => s.game)!;
  const patchBiz = useGameStore((s) => s.patchBusinessState);
  const bizs = selectPlayerBusinesses(game);

  const renderOccupancy = (biz: Business) => {
    if (biz.propertyId) {
      const prop = game.properties[biz.propertyId];
      const loan = prop?.mortgageId ? game.mortgages[prop.mortgageId] : undefined;
      return (
        <span className="text-emerald-300">
          🏢 Owned · {prop?.address ?? "—"}
          {loan && ` · ${formatMoney(loan.monthlyPayment, { compact: true })}/mo mortgage`}
        </span>
      );
    }
    const st = biz.state as unknown as { rentMonthly?: number };
    if (st.rentMonthly && st.rentMonthly > 0) {
      return (
        <span className="text-ink-400">
          Rented · {formatMoney(st.rentMonthly, { compact: true })}/mo
        </span>
      );
    }
    return <span className="text-ink-500">No rent</span>;
  };

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
            and open your first corner store — or save up for a cafe, bar, or restaurant.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Your businesses</h1>
      <p className="text-sm text-ink-400">
        {bizs.length} active · pricing, staffing, marketing. KPIs update every
        in-game hour.
      </p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {bizs.map((biz) => {
          const marketName = game.markets[biz.locationId]?.name ?? "—";
          const occupancy = renderOccupancy(biz);
          const onPatch = (patch: Partial<Business["state"]>) => patchBiz(biz.id, patch);
          switch (biz.type) {
            case "cafe":
              return (
                <CafeCard
                  key={biz.id}
                  biz={biz}
                  marketName={marketName}
                  occupancy={occupancy}
                  onPatch={onPatch}
                />
              );
            case "bar":
              return (
                <BarCard
                  key={biz.id}
                  biz={biz}
                  marketName={marketName}
                  occupancy={occupancy}
                  onPatch={onPatch}
                />
              );
            case "restaurant":
              return (
                <RestaurantCard
                  key={biz.id}
                  biz={biz}
                  marketName={marketName}
                  occupancy={occupancy}
                  onPatch={onPatch}
                />
              );
            default:
              return (
                <CornerStoreCard
                  key={biz.id}
                  biz={biz}
                  marketName={marketName}
                  occupancy={occupancy}
                  onPatch={onPatch}
                />
              );
          }
        })}
      </div>
    </div>
  );
}

// ---------- Corner store card (original) ----------

function CornerStoreCard({
  biz,
  marketName,
  occupancy,
  onPatch,
}: {
  biz: Business;
  marketName: string;
  occupancy: ReactNode;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  const st = biz.state as unknown as CornerStoreState;
  return (
    <Card
      title={biz.name}
      subtitle={`🏪  ${marketName} · opened tick ${biz.openedAtTick}`}
    >
      <div className="text-xs mb-3">{occupancy}</div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <StatTile
          label="Weekly revenue"
          value={formatMoney(biz.kpis.weeklyRevenue, { compact: true })}
        />
        <StatTile
          label="Weekly profit"
          value={formatMoney(biz.kpis.weeklyProfit, { compact: true, sign: true })}
          delta={
            biz.kpis.weeklyRevenue > 0
              ? (biz.kpis.weeklyProfit / biz.kpis.weeklyRevenue) * 100
              : 0
          }
        />
        <StatTile label="CSAT" value={biz.kpis.customerSatisfaction.toFixed(0)} />
        <StatTile label="Stock" value={`${Math.round(biz.derived.stockLevel * 100)}%`} />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({ marketingWeekly: (st.marketingWeekly ?? 0) + 5000 })
          }
        >
          + Marketing
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({
              marketingWeekly: Math.max(0, (st.marketingWeekly ?? 0) - 5000),
            })
          }
        >
          − Marketing
        </Button>
      </div>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-4 mb-2">
        Staff ({st.staff.length})
      </h4>
      <ul className="divide-y divide-ink-800 text-sm">
        {st.staff.map((s) => (
          <li key={s.id} className="flex items-center justify-between py-1.5">
            <div className="min-w-0">
              <div className="truncate">{s.name}</div>
              <div className="text-xs text-ink-400">
                Skill {s.skill.toFixed(0)} · Morale {s.morale.toFixed(0)}
              </div>
            </div>
            <div className="text-xs font-mono tabular-nums text-ink-300">
              {formatMoney(s.hourlyWageCents)} /hr
            </div>
          </li>
        ))}
      </ul>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-4 mb-2">
        Inventory
      </h4>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {Object.values(st.skus).slice(0, 10).map((s) => (
          <li key={s.skuId} className="flex items-center justify-between">
            <span className="text-ink-300 truncate">{SKU_LABELS[s.skuId]}</span>
            <span
              className={
                "font-mono tabular-nums " +
                (s.stock === 0
                  ? "text-loss"
                  : s.stock < s.restockThreshold
                    ? "text-accent"
                    : "text-ink-200")
              }
            >
              {s.stock}
            </span>
          </li>
        ))}
      </ul>
      {Object.values(st.skus).length > 10 && (
        <p className="text-[11px] text-ink-500 mt-2">
          + {Object.values(st.skus).length - 10} more SKUs…
        </p>
      )}
    </Card>
  );
}

// ---------- Cafe card ----------

const TIER_LABELS: Record<CafeQualityTier, string> = {
  basic: "Basic",
  craft: "Craft",
  premium: "Premium",
};

function CafeCard({
  biz,
  marketName,
  occupancy,
  onPatch,
}: {
  biz: Business;
  marketName: string;
  occupancy: ReactNode;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  const st = biz.state as unknown as CafeState;
  const csat = biz.kpis.customerSatisfaction;
  const myHaloContribution = haloContribution(csat, "cafe");
  const avgCraft =
    st.baristas.length === 0
      ? 0
      : st.baristas.reduce((a, b) => a + b.craft, 0) / st.baristas.length;

  const csatTone =
    csat >= 85 ? "text-money" : csat >= 70 ? "text-ink-100" : "text-loss";

  return (
    <Card
      title={biz.name}
      subtitle={`☕  ${marketName} · ${TIER_LABELS[st.qualityTier]} tier · opened tick ${biz.openedAtTick}`}
    >
      <div className="text-xs mb-3">{occupancy}</div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <StatTile
          label="Customer satisfaction"
          value={<span className={csatTone}>{csat.toFixed(0)}</span>}
        />
        <StatTile
          label="Weekly profit"
          value={formatMoney(biz.kpis.weeklyProfit, { compact: true, sign: true })}
          delta={
            biz.kpis.weeklyRevenue > 0
              ? (biz.kpis.weeklyProfit / biz.kpis.weeklyRevenue) * 100
              : 0
          }
        />
        <StatTile
          label="Reputation halo contrib"
          value={`+${(myHaloContribution * 100).toFixed(0)}%`}
        />
        <StatTile
          label="Ambience"
          value={`${Math.round(st.ambience * 100)}%`}
        />
      </div>

      <p className="text-xs text-ink-400 mb-3">
        This cafe radiates <span className="text-money">+{(myHaloContribution * 100).toFixed(0)}%</span>{" "}
        foot traffic to every business you own in {marketName}. Push CSAT up to
        grow the halo.
      </p>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-2 mb-2">
        Quality tier
      </h4>
      <div className="flex flex-wrap gap-2 mb-3">
        {(["basic", "craft", "premium"] as CafeQualityTier[]).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={st.qualityTier === t ? "primary" : "secondary"}
            onClick={() => onPatch({ qualityTier: t })}
          >
            {TIER_LABELS[t]}
          </Button>
        ))}
      </div>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-2 mb-2">
        Levers
      </h4>
      <div className="flex flex-wrap gap-2 mb-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({ marketingWeekly: (st.marketingWeekly ?? 0) + 5000 })
          }
        >
          + Marketing
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({
              marketingWeekly: Math.max(0, (st.marketingWeekly ?? 0) - 5000),
            })
          }
        >
          − Marketing
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({ ambience: Math.min(1, (st.ambience ?? 0) + 0.2) })
          }
          title="Refresh the space (capex pulse — ambience bump)."
        >
          Refresh ambience
        </Button>
      </div>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-4 mb-2">
        Baristas ({st.baristas.length}) · avg craft {avgCraft.toFixed(0)}
      </h4>
      <ul className="divide-y divide-ink-800 text-sm">
        {st.baristas.map((b) => (
          <li key={b.id} className="flex items-center justify-between py-1.5">
            <div className="min-w-0">
              <div className="truncate">{b.name}</div>
              <div className="text-xs text-ink-400">
                Craft {b.craft.toFixed(0)} · Morale {b.morale.toFixed(0)}
              </div>
            </div>
            <div className="text-xs font-mono tabular-nums text-ink-300">
              {formatMoney(b.hourlyWageCents)} /hr
            </div>
          </li>
        ))}
      </ul>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-4 mb-2">
        Menu
      </h4>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {Object.values(st.menu).slice(0, 10).map((m) => (
          <li key={m.id} className="flex items-center justify-between">
            <span className="text-ink-300 truncate">{MENU_LABELS[m.id]}</span>
            <span className="font-mono tabular-nums text-ink-200">
              {formatMoney(m.price)} · {m.stock}/{m.dailyPar}
            </span>
          </li>
        ))}
      </ul>
      {Object.values(st.menu).length > 10 && (
        <p className="text-[11px] text-ink-500 mt-2">
          + {Object.values(st.menu).length - 10} more items…
        </p>
      )}
    </Card>
  );
}

// ---------- Bar card ----------

const LIQUOR_LABELS: Record<LiquorTier, string> = {
  well: "Well",
  call: "Call",
  top_shelf: "Top Shelf",
};

function BarCard({
  biz,
  marketName,
  occupancy,
  onPatch,
}: {
  biz: Business;
  marketName: string;
  occupancy: ReactNode;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  const st = biz.state as unknown as BarState;
  const csat = biz.kpis.customerSatisfaction;
  const myHaloContribution = haloContribution(csat, "bar");
  const csatTone =
    csat >= 85 ? "text-money" : csat >= 70 ? "text-ink-100" : "text-loss";
  const riskTone =
    biz.derived.riskScore >= 50
      ? "text-loss"
      : biz.derived.riskScore >= 25
        ? "text-accent"
        : "text-money";

  return (
    <Card
      title={biz.name}
      subtitle={`🍻  ${marketName} · ${LIQUOR_LABELS[st.liquorTier]} shelf · opened tick ${biz.openedAtTick}`}
    >
      <div className="text-xs mb-3">{occupancy}</div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <StatTile
          label="Customer satisfaction"
          value={<span className={csatTone}>{csat.toFixed(0)}</span>}
        />
        <StatTile
          label="Weekly profit"
          value={formatMoney(biz.kpis.weeklyProfit, { compact: true, sign: true })}
          delta={
            biz.kpis.weeklyRevenue > 0
              ? (biz.kpis.weeklyProfit / biz.kpis.weeklyRevenue) * 100
              : 0
          }
        />
        <StatTile
          label="Halo contrib"
          value={`+${(myHaloContribution * 100).toFixed(0)}%`}
        />
        <StatTile
          label="Compliance risk"
          value={<span className={riskTone}>{biz.derived.riskScore.toFixed(0)}</span>}
        />
      </div>

      <p className="text-xs text-ink-400 mb-3">
        Bars peak late (10pm–12am). Happy hour lifts traffic during the slow
        slot. Keep occupancy under licensed capacity and ID-check diligently to
        stay off the inspector&apos;s radar.
      </p>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-2 mb-2">
        Liquor shelf
      </h4>
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

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-2 mb-2">
        Happy hour {st.happyHour.enabled ? "· ON" : "· off"}
      </h4>
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
          + ID checks
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({ ambience: Math.min(1, (st.ambience ?? 0) + 0.2) })
          }
          title="Refresh the space (capex pulse — ambience bump)."
        >
          Refresh ambience
        </Button>
      </div>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-4 mb-2">
        Bartenders ({st.bartenders.length})
      </h4>
      <ul className="divide-y divide-ink-800 text-sm">
        {st.bartenders.map((b) => (
          <li key={b.id} className="flex items-center justify-between py-1.5">
            <div className="min-w-0">
              <div className="truncate">{b.name}</div>
              <div className="text-xs text-ink-400">
                Craft {b.craft.toFixed(0)} · Morale {b.morale.toFixed(0)}
              </div>
            </div>
            <div className="text-xs font-mono tabular-nums text-ink-300">
              {formatMoney(b.hourlyWageCents)} /hr + tips
            </div>
          </li>
        ))}
      </ul>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-4 mb-2">
        Drink list
      </h4>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {Object.values(st.menu).slice(0, 10).map((d) => (
          <li key={d.id} className="flex items-center justify-between">
            <span className="text-ink-300 truncate">{DRINK_LABELS[d.id]}</span>
            <span className="font-mono tabular-nums text-ink-200">
              {formatMoney(d.price)}
              {d.happyHourEligible && st.happyHour.enabled ? " · HH" : ""}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- Restaurant card ----------

const PROGRAM_LABELS: Record<MenuProgram, string> = {
  diner: "Diner",
  bistro: "Bistro",
  chef_driven: "Chef-Driven",
};

function RestaurantCard({
  biz,
  marketName,
  occupancy,
  onPatch,
}: {
  biz: Business;
  marketName: string;
  occupancy: ReactNode;
  onPatch: (patch: Partial<Business["state"]>) => void;
}) {
  const st = biz.state as unknown as RestaurantState;
  const csat = biz.kpis.customerSatisfaction;
  const myHaloContribution = haloContribution(csat, "restaurant");
  const csatTone =
    csat >= 85 ? "text-money" : csat >= 70 ? "text-ink-100" : "text-loss";

  return (
    <Card
      title={biz.name}
      subtitle={`🍽️  ${marketName} · ${PROGRAM_LABELS[st.program]} · opened tick ${biz.openedAtTick}`}
    >
      <div className="text-xs mb-3">{occupancy}</div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <StatTile
          label="Customer satisfaction"
          value={<span className={csatTone}>{csat.toFixed(0)}</span>}
        />
        <StatTile
          label="Weekly profit"
          value={formatMoney(biz.kpis.weeklyProfit, { compact: true, sign: true })}
          delta={
            biz.kpis.weeklyRevenue > 0
              ? (biz.kpis.weeklyProfit / biz.kpis.weeklyRevenue) * 100
              : 0
          }
        />
        <StatTile
          label="Halo contrib"
          value={`+${(myHaloContribution * 100).toFixed(0)}%`}
        />
        <StatTile
          label="Reservation fill"
          value={`${Math.round(st.reservationDensity * 100)}%`}
        />
      </div>

      <p className="text-xs text-ink-400 mb-3">
        Lunch and dinner peaks. Reservations steady demand; more reservations =
        fewer blockbuster nights, but fewer empty seats too. Menu refresh every
        12 weeks keeps CSAT ceiling intact.
      </p>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-2 mb-2">
        Menu program
      </h4>
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

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-2 mb-2">
        Reservation density · {Math.round(st.reservationDensity * 100)}%
      </h4>
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
          title="New seasonal menu (resets menu-staleness timer)."
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
          Refresh ambience
        </Button>
      </div>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-4 mb-2">
        Chef · {st.chef.name}
      </h4>
      <p className="text-xs text-ink-400 mb-3">
        Craft {st.chef.craft.toFixed(0)} · Morale {st.chef.morale.toFixed(0)} ·
        Tenure {st.chef.tenureWeeks}w ·{" "}
        {formatMoney(st.chef.weeklySalaryCents, { compact: true })}/wk
      </p>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-2 mb-2">
        Front + back of house
      </h4>
      <ul className="divide-y divide-ink-800 text-sm">
        {[...st.cooks, ...st.servers].map((p) => (
          <li key={p.id} className="flex items-center justify-between py-1.5">
            <div className="min-w-0">
              <div className="truncate">{p.name}</div>
              <div className="text-xs text-ink-400">
                Craft {p.craft.toFixed(0)} · Morale {p.morale.toFixed(0)}
              </div>
            </div>
            <div className="text-xs font-mono tabular-nums text-ink-300">
              {formatMoney(p.hourlyWageCents)} /hr
            </div>
          </li>
        ))}
      </ul>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-4 mb-2">
        Menu
      </h4>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {Object.values(st.menu).slice(0, 10).map((m) => (
          <li key={m.id} className="flex items-center justify-between">
            <span className="text-ink-300 truncate">{DISH_LABELS[m.id]}</span>
            <span className="font-mono tabular-nums text-ink-200">
              {formatMoney(m.price)}
            </span>
          </li>
        ))}
      </ul>
      {Object.values(st.menu).length > 10 && (
        <p className="text-[11px] text-ink-500 mt-2">
          + {Object.values(st.menu).length - 10} more items…
        </p>
      )}
    </Card>
  );
}
