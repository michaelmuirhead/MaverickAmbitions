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
import { DistressBanner } from "@/components/game/DistressBanner";

import { useGameStore } from "@/state/store";
import { formatMoney } from "@/lib/money";
import { createRng } from "@/lib/rng";
import { pickName } from "@/data/names";

import type {
  Business,
  Cents,
  DayHoursValue,
  DayOfWeek,
  HoursSchedule,
  LedgerEntry,
  Market,
  MarketingChannel,
  Property,
} from "@/types/game";

import type { CornerStoreState } from "@/engine/business/retail";
import type { CafeState, CafeQualityTier } from "@/engine/business/cafe";
import type { BarState } from "@/engine/business/bar";
import type { RestaurantState } from "@/engine/business/restaurant";
import type { LiquorTier, MenuProgram } from "@/engine/business/hospitality";
import { priceAttractiveness } from "@/engine/economy/market";
import { haloContribution } from "@/engine/economy/reputation";
import { ECONOMY } from "@/engine/economy/constants";
import {
  allHours,
  defaultHospitalityHours,
  defaultRetailHours,
  effectiveMarketingScore,
  hoursCsatBonus,
  laborHoursMultiplier,
  leverKindFor,
  leversOf,
  scheduledHoursPerWeek,
  totalWeeklyMarketing,
} from "@/engine/business/leverState";
import {
  MARKETING_CHANNELS,
  MARKETING_CHANNEL_IDS,
} from "@/data/marketingChannels";
import { getMarketDemographics } from "@/data/marketDemographics";
import { SKU_LABELS } from "@/data/items";
import { MENU_LABELS } from "@/data/menu";
import { DRINK_LABELS } from "@/data/barDrinks";
import { DISH_LABELS } from "@/data/restaurantMenu";

type TabKey =
  | "overview"
  | "inventory"
  | "staff"
  | "marketing"
  | "hours"
  | "finance";

const TAB_LABELS: Record<TabKey, string> = {
  overview: "Overview",
  inventory: "Inventory",
  staff: "Staff",
  marketing: "Marketing",
  hours: "Hours",
  finance: "Finance",
};

export function BusinessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const game = useGameStore((s) => s.game)!;
  const patchBiz = useGameStore((s) => s.patchBusinessState);
  const closeVoluntarily = useGameStore((s) => s.closeBusinessVoluntarily);
  const [tab, setTab] = useState<TabKey>("overview");

  const biz = id ? game.businesses[id] : undefined;

  if (!biz || biz.ownerId !== game.player.id) {
    // Either the id is bogus, or the player doesn't own it (rival biz, closed).
    return <Navigate to="/business" replace />;
  }

  const onPatch = (patch: Partial<Business["state"]>) => patchBiz(biz.id, patch);
  const onCloseVoluntarily = () => {
    // After this resolves, the biz record is gone from game.businesses
    // and the guard above re-renders with <Navigate to="/business">.
    closeVoluntarily(biz.id);
  };
  const marketName = game.markets[biz.locationId]?.name ?? biz.locationId;

  // Every type uses the same 6 tabs — Hours lever (v0.10) gets its own tab.
  const tabs: TabKey[] = [
    "overview",
    "inventory",
    "staff",
    "marketing",
    "hours",
    "finance",
  ];

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

      <DistressBanner biz={biz} onCloseVoluntarily={onCloseVoluntarily} />

      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <span>{bizIcon(biz.type)}</span>
          <span className="truncate">{biz.name}</span>
        </h1>
        <p className="text-sm text-ink-400 mt-1">
          {bizLabel(biz.type)} · {marketName} · opened tick{" "}
          {biz.openedAtTick.toLocaleString()}
        </p>
        <HostedSpaceIndicator biz={biz} />
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
      {tab === "marketing" && <MarketingTab biz={biz} />}
      {tab === "hours" && <HoursTab biz={biz} />}
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

/**
 * v0.9 Failure & Flow: surface whether the business is on a player-owned
 * property or leasing commercial space. Shown directly below the page
 * header so the player can read their exposure at a glance without
 * hunting through the Finance tab.
 *
 * Owned space → green chip + click-through to the finance real-estate
 * rail (we don't have a dedicated /real-estate route yet).
 * Leasing    → neutral chip with the monthly rent figure pulled from
 * `state.rentMonthly`, which the engine charges weekly at /4.
 */
function HostedSpaceIndicator({ biz }: { biz: Business }) {
  const property = useHostedProperty(biz);
  const rentMonthly = readRentMonthly(biz);

  if (property) {
    // Owned space.
    return (
      <Link
        to="/finance"
        className="mt-2 inline-flex items-center gap-2 rounded-full border border-money/60 bg-money/10 px-3 py-1 text-xs text-money hover:bg-money/15 transition-colors"
        title="You own the building. No rent, but property taxes + maintenance still apply. Click to view in your property rail."
      >
        <span aria-hidden>🏠</span>
        <span className="font-semibold">Owned space</span>
        <span className="text-ink-300 font-normal truncate max-w-[16rem]">
          · {property.address}
        </span>
      </Link>
    );
  }

  if (rentMonthly !== undefined && rentMonthly > 0) {
    return (
      <div
        className="mt-2 inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900/60 px-3 py-1 text-xs text-ink-200"
        title="Leased commercial space. Rent is pulled weekly from the business's operating cash (monthly figure shown ÷ 4 per week)."
      >
        <span aria-hidden>📝</span>
        <span className="font-semibold text-ink-100">Leasing</span>
        <span className="text-ink-300 font-normal">
          · {formatMoney(rentMonthly, { compact: true })}/mo
        </span>
      </div>
    );
  }

  // No rent line for this business type (e.g. food truck). Stay quiet.
  return null;
}

/** Look up the hosted Property record for a business, if any. Used by
 *  both the header indicator and the Finance-tab rent row. */
function useHostedProperty(biz: Business): Property | undefined {
  const property = useGameStore((s) => {
    if (!biz.propertyId || !s.game) return undefined;
    return s.game.properties[biz.propertyId];
  });
  return property;
}

/** Every storefront / hospitality / project engine carries its monthly
 *  rent on `state.rentMonthly`. Project-based engines that don't have a
 *  storefront (e.g. food_truck) leave it undefined. */
function readRentMonthly(biz: Business): number | undefined {
  const raw = (biz.state as { rentMonthly?: number }).rentMonthly;
  return typeof raw === "number" ? raw : undefined;
}

/**
 * v0.9 Lease → owned migration.
 *
 * Shown on the Finance tab when the business is currently leasing and the
 * player owns one or more vacant properties in the same market. Wipes the
 * monthly rent line as soon as the relocation succeeds — the engine
 * reads `state.rentMonthly` fresh each week.
 */
function ConvertToOwnedCard({
  biz,
  onResult,
}: {
  biz: Business;
  onResult: (msg: string) => void;
}) {
  const vacant = useGameStore((s) => {
    if (!s.game) return [] as Property[];
    return Object.values(s.game.properties).filter(
      (p) =>
        p.ownerId === s.game!.player.id &&
        p.marketId === biz.locationId &&
        !p.hostedBusinessId,
    );
  });
  const convert = useGameStore((s) => s.convertBusinessToOwned);
  const [selectedId, setSelectedId] = useState<string>("");

  if (vacant.length === 0) {
    return (
      <Card
        title="Move onto an owned property"
        subtitle="You don't own any vacant properties in this market."
      >
        <p className="text-xs text-ink-400">
          Buy a commercial property in this market from the Market page to
          zero out this business's rent line. You'll still owe property tax
          and maintenance each month — but those settle from your personal
          cash, not the business.
        </p>
      </Card>
    );
  }

  const chosen =
    vacant.find((p) => p.id === selectedId) ?? vacant[0];

  return (
    <Card
      title="Move onto an owned property"
      subtitle={`${vacant.length} vacant ${vacant.length === 1 ? "property" : "properties"} available in this market`}
    >
      <p className="text-xs text-ink-400 mb-3">
        Relocating wipes the monthly rent immediately. No cash changes
        hands — you already own the building. Property tax and maintenance
        still settle against your personal cash at month-end.
      </p>

      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
        <label className="flex-1 min-w-0">
          <span className="block text-[11px] text-ink-400 mb-1">
            Target property
          </span>
          <select
            value={chosen.id}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full rounded-lg border border-ink-700 bg-ink-900 text-ink-50 px-2 py-1.5 text-xs"
          >
            {vacant.map((p) => (
              <option key={p.id} value={p.id}>
                {p.address} · {p.class}-class · {p.sqft.toLocaleString()} sqft
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const res = convert(biz.id, chosen.id);
            if (!res.ok) {
              onResult(res.error ?? "Couldn't move this business onto that property.");
              return;
            }
            onResult(
              `${biz.name} moved onto ${chosen.address} — rent line zeroed.`,
            );
          }}
          title="Move this business onto the selected owned property."
        >
          Move onto owned property
        </Button>
      </div>
    </Card>
  );
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
      <StaffingWarningBanner biz={biz} />

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

      <TrafficConversionCard biz={biz} />

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

/**
 * v0.8.1: Traffic & conversion surface.
 *
 * Storefront engines (retail.ts, retailBase.ts — 9 business types as of
 * v0.8.1) report weekly visitors, units sold, and conversion in their
 * KPIs. For every other type these come back undefined and we render a
 * "coming in v0.9" placeholder instead of a broken card. The current-hour
 * foot-traffic number lives on `derived.footTraffic` and is populated by
 * every storefront engine.
 */
/**
 * v0.8.1: Staffing warning banner.
 *
 * Every storefront/hospitality engine short-circuits to zero revenue when
 * `staff.length === 0`. Players without a heads-up have historically
 * bought a store, walked away, and come back wondering why revenue is
 * flat. This surfaces that gap.
 *
 * Tiers:
 *   CRIT  — any roster section is empty → 100% sales loss vs reference.
 *   WARN  — roster filled but service quality < 0.25, meaning the
 *           staffing term of the conversion multiplier is pinned near
 *           the 0.6× floor instead of the ~1.05× "typical" crew.
 *
 * Reference service is 0.5 (skill ~70 × morale ~72 = 0.504), which maps
 * to a 1.1× multiplier. We report the gap between current and reference
 * as an approximate "X% of potential sales" number so the player can
 * tell whether hiring is priority #1 or just a tuning nudge.
 */
function StaffingWarningBanner({ biz }: { biz: Business }) {
  const roster = buildRoster(biz);

  // Type doesn't use a staff roster in the game (e.g. real estate firm
  // before v0.9) — no warning to surface.
  if (roster.sections.length === 0) return null;

  const emptySections = roster.sections.filter((s) => s.people.length === 0);
  if (emptySections.length > 0) {
    const labels = emptySections.map((s) => s.label.toLowerCase()).join(" or ");
    return (
      <div
        className="rounded-xl border-2 border-loss/70 bg-loss/10 px-4 py-3 flex items-start gap-3"
        role="alert"
      >
        <span className="mt-1.5 h-2 w-2 rounded-full shrink-0 bg-loss" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-loss">
            No {labels} on shift — store generates $0 in sales
          </div>
          <p className="text-xs text-ink-300 mt-0.5 leading-snug">
            The sim skips revenue generation entirely when a required
            roster is empty. Hire at least one person in the{" "}
            <span className="font-semibold text-ink-100">Staff</span> tab
            to turn the lights back on.
          </p>
        </div>
      </div>
    );
  }

  // All sections have at least one person — check service floor.
  const REFERENCE_SERVICE = 0.5; // skill 70 × morale 72 = 0.504
  const referenceMult = 0.6 + REFERENCE_SERVICE; // 1.1
  const worstSection = roster.sections.reduce<
    { section: (typeof roster.sections)[number]; service: number } | null
  >((worst, s) => {
    const service = computeServiceQuality(s.people);
    if (!worst || service < worst.service) return { section: s, service };
    return worst;
  }, null);

  if (!worstSection) return null;

  const currentMult = 0.6 + worstSection.service;
  const salesGapPct = Math.max(
    0,
    ((referenceMult - currentMult) / referenceMult) * 100,
  );

  // Only bother the player when the gap is meaningful (≥ 10%).
  if (salesGapPct < 10) return null;

  const tone =
    salesGapPct >= 25
      ? "border-loss/70 bg-loss/10 text-loss"
      : "border-amber-700/60 bg-amber-950/40 text-amber-200";
  const dotTone = salesGapPct >= 25 ? "bg-loss" : "bg-amber-400";
  const headline =
    salesGapPct >= 25
      ? "Severely understaffed — sales well below potential"
      : "Understaffed — some sales slipping through the cracks";

  return (
    <div
      className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${tone}`}
      role="alert"
    >
      <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${dotTone}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{headline}</div>
        <p className="text-xs text-ink-300 mt-0.5 leading-snug">
          {worstSection.section.label} service is{" "}
          <span className="font-mono tabular-nums">
            {(worstSection.service * 100).toFixed(0)}%
          </span>{" "}
          — roughly{" "}
          <span className="font-mono tabular-nums">
            {salesGapPct.toFixed(0)}%
          </span>{" "}
          below a typical crew's conversion multiplier. Hire more people,
          raise wages above band to lift morale, or avoid layoffs (each
          fire pings the whole crew −8 morale).
        </p>
      </div>
    </div>
  );
}

function TrafficConversionCard({ biz }: { biz: Business }) {
  const hasInstrumented =
    biz.kpis.weeklyVisitors !== undefined ||
    biz.kpis.weeklyUnitsSold !== undefined ||
    biz.kpis.weeklyConversion !== undefined;

  if (!hasInstrumented) {
    return (
      <Card
        title="Traffic & conversion"
        subtitle="Visitors, units sold, and conversion rate"
      >
        <div className="text-xs text-ink-500">
          Traffic instrumentation for this business type lands in v0.9
          (Marketing & Levers update). For now, use weekly revenue and CSAT
          as proxies.
        </div>
      </Card>
    );
  }

  const visitors = biz.kpis.weeklyVisitors ?? 0;
  const unitsSold = biz.kpis.weeklyUnitsSold ?? 0;
  const conversion = biz.kpis.weeklyConversion ?? 0;
  const revPerVisitor =
    visitors > 0 ? biz.kpis.weeklyRevenue / visitors : 0;
  const unitsPerVisitor = visitors > 0 ? unitsSold / visitors : 0;
  const footTraffic = biz.derived.footTraffic;

  return (
    <Card
      title="Traffic & conversion"
      subtitle="How many walked in, and how many bought."
    >
      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label="Foot traffic"
          value={footTraffic.toFixed(1)}
          hint="Current-hour visitors per hour (market capture)"
        />
        <StatTile
          label="Weekly visitors"
          value={visitors.toLocaleString()}
          hint="Estimated people who entered this week"
        />
        <StatTile
          label="Conversion rate"
          value={`${(conversion * 100).toFixed(1)}%`}
          hint={
            conversion >= 0.4
              ? "Strong — price & service are working"
              : conversion >= 0.25
                ? "OK — room to improve with better pricing/staff"
                : "Weak — too few visitors are buying"
          }
        />
        <StatTile
          label="Units sold"
          value={unitsSold.toLocaleString()}
          hint={`${unitsPerVisitor.toFixed(2)} units per visitor`}
        />
        <StatTile
          label="Revenue / visitor"
          value={formatMoney(Math.round(revPerVisitor))}
          hint="Average spend per person who walked in"
        />
        <StatTile
          label="Avg ticket"
          value={
            unitsSold > 0
              ? formatMoney(Math.round(biz.kpis.weeklyRevenue / unitsSold))
              : "—"
          }
          hint="Revenue per unit sold"
        />
      </div>
      <p className="mt-3 text-xs text-ink-500">
        Foot traffic is driven by the market (population × desirability ×
        macro wallet). Conversion is driven by your pricing, service quality
        (staff), and marketing. Units-per-visitor rises when you have more
        attractive SKUs in stock. Weekly numbers update each Sunday
        midnight.
      </p>
    </Card>
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

/** v0.8.1: per-tier explainer strings shown below the tier buttons so
 *  players can see what each tier costs and buys them. Numbers are kept in
 *  sync with CAFE_TIER_PROFILES in cafe.ts. */
const CAFE_TIER_EXPLAINERS: Record<CafeQualityTier, string> = {
  basic:   "Basic   · −20% price, −25% cost, CSAT caps at 75. Best when foot traffic is thin and margin matters more than ceiling.",
  craft:   "Craft   · Reference tier. CSAT caps at 88. Sensible default if you're not sure.",
  premium: "Premium · +45% price, +35% cost, +25% wages. CSAT caps at 95, but you need the ambience (floor 70%) and crew to back it up.",
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
            title={CAFE_TIER_EXPLAINERS[t]}
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
          title="Capex pulse: +20% ambience. Ambience floors under premium are high — you'll bleed CSAT until the room matches the tier."
        >
          Refresh ambience ({Math.round(st.ambience * 100)}%)
        </Button>
      </div>
      <p className="mt-3 text-[11px] leading-snug text-ink-500">
        {CAFE_TIER_EXPLAINERS[st.qualityTier]}
      </p>
    </Card>
  );
}

const LIQUOR_LABELS: Record<LiquorTier, string> = {
  well: "Well",
  call: "Call",
  top_shelf: "Top Shelf",
};

/** v0.8.1: per-tier explainer for the bar shelf. Synced with LIQUOR_TIER. */
const LIQUOR_EXPLAINERS: Record<LiquorTier, string> = {
  well:      "Well       · −15% price, −25% cost, CSAT caps at 72, no tip lift. Cheapest way to keep the doors open.",
  call:      "Call       · Reference tier. CSAT caps at 85, +2% tip pool.",
  top_shelf: "Top Shelf  · +55% price, +45% cost, CSAT caps at 94, +5% tip pool. Pulls higher-spend patrons when ambience keeps up.",
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
      <div className="flex flex-wrap gap-2 mb-1">
        {(["well", "call", "top_shelf"] as LiquorTier[]).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={st.liquorTier === t ? "primary" : "secondary"}
            onClick={() => onPatch({ liquorTier: t })}
            title={LIQUOR_EXPLAINERS[t]}
          >
            {LIQUOR_LABELS[t]}
          </Button>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-ink-500 mb-3">
        {LIQUOR_EXPLAINERS[st.liquorTier]}
      </p>

      <div className="text-[11px] uppercase tracking-wide text-ink-400 mb-1">
        Happy hour {st.happyHour.enabled ? "· ON" : "· off"}
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        <Button
          size="sm"
          variant={st.happyHour.enabled ? "primary" : "secondary"}
          onClick={() =>
            onPatch({
              happyHour: { ...st.happyHour, enabled: !st.happyHour.enabled },
            })
          }
          title="Discounts eligible drinks during the window — pulls in more covers but eats margin per drink. Net impact shows up in weekly P&L."
        >
          Toggle {st.happyHour.startHour}:00–{st.happyHour.endHour}:00
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({ idCheckDiligence: Math.min(1, st.idCheckDiligence + 0.1) })
          }
          title="Higher ID-check diligence reduces fine risk from underage patrons at the cost of slightly slower service throughput. +10% per click."
        >
          + ID checks ({Math.round(st.idCheckDiligence * 100)}%)
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({ ambience: Math.min(1, (st.ambience ?? 0) + 0.2) })
          }
          title="Capex pulse: +20% ambience. Bars need ambience to hold CSAT at higher shelf tiers."
        >
          Refresh ambience ({Math.round(st.ambience * 100)}%)
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-ink-500">
        Happy hour trades margin for volume. ID checks reduce fine risk but
        slow service. Ambience decays; pulse it when the shelf is top tier.
      </p>
    </Card>
  );
}

const PROGRAM_LABELS: Record<MenuProgram, string> = {
  diner: "Diner",
  bistro: "Bistro",
  chef_driven: "Chef-Driven",
};

/** v0.8.1: per-program explainer for the restaurant menu. Synced with MENU_PROGRAM. */
const PROGRAM_EXPLAINERS: Record<MenuProgram, string> = {
  diner:       "Diner       · −10% price, −20% cost, CSAT caps at 75. Fast 45-min turns move covers — grind economics.",
  bistro:      "Bistro      · +10% price, reference cost, CSAT caps at 88, +3% tip pool. Slower 70-min turns but higher ticket.",
  chef_driven: "Chef-Driven · +60% price, +40% cost, CSAT caps at 95, +6% tip pool. Longest turn (95 min) — needs craft, ambience, and reservations to land.",
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
      <div className="flex flex-wrap gap-2 mb-1">
        {(["diner", "bistro", "chef_driven"] as MenuProgram[]).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={st.program === t ? "primary" : "secondary"}
            onClick={() => onPatch({ program: t })}
            title={PROGRAM_EXPLAINERS[t]}
          >
            {PROGRAM_LABELS[t]}
          </Button>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-ink-500 mb-3">
        {PROGRAM_EXPLAINERS[st.program]}
      </p>

      <div className="text-[11px] uppercase tracking-wide text-ink-400 mb-1">
        Reservation density · {Math.round(st.reservationDensity * 100)}%
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({
              reservationDensity: Math.max(0, st.reservationDensity - 0.1),
            })
          }
          title="Lower reservation density = more walk-in capacity, but revenue swings more with traffic."
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
          title="Higher density smooths revenue by locking in covers, but caps upside on peak nights."
        >
          + 10%
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onPatch({ ticksSinceMenuRefresh: 0 })}
          title="Seasonal refresh resets the staleness timer — menus quietly lose CSAT over time if left alone."
        >
          Refresh menu
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onPatch({ ambience: Math.min(1, (st.ambience ?? 0) + 0.2) })
          }
          title="Capex pulse: +20% ambience. Chef-driven rooms need ambience to justify the price."
        >
          Refresh ambience ({Math.round(st.ambience * 100)}%)
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-ink-500">
        Reservations trade peak upside for predictable covers. Menu refresh is
        free but easy to forget — stale menus quietly eat CSAT.
      </p>
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

/**
 * v0.8.1: Compute the 0..1 service-quality score for a roster section.
 *
 * Mirrors the formula inside every retail/hospitality engine:
 *   avg(skill * morale) / 10000
 * It's the term conversion is multiplied by in the sim — displayed here
 * so the player knows whether staffing is helping or hurting sales.
 */
function computeServiceQuality(people: RosterStaff[]): number {
  if (people.length === 0) return 0;
  const sum = people.reduce(
    (a, p) => a + (p.aptitude * p.morale) / 10000,
    0,
  );
  return sum / people.length;
}

/**
 * v0.8.1: What service quality would be if we added one more staff member
 * with the given aptitude (defaults to morale 72, same as the hire helper).
 */
function previewServiceAfterHire(
  current: RosterStaff[],
  newAptitude: number,
  newMorale = 72,
): number {
  const next = [
    ...current.map((p) => ({
      skillMorale: (p.aptitude * p.morale) / 10000,
    })),
    { skillMorale: (newAptitude * newMorale) / 10000 },
  ];
  return next.reduce((a, p) => a + p.skillMorale, 0) / next.length;
}

/**
 * Convert a service-quality score (0..1) into the conversion-multiplier
 * term the sim applies — `(0.6 + service)`. Rendered as a tooltip hint so
 * the player can see how much hiring moves the needle.
 */
function serviceToConvMultiplier(service: number): number {
  return 0.6 + service;
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

  // v0.8.1: Service-quality is the staffing term of the conversion multiplier.
  // Sim applies `(0.6 + service)` — so an empty roster gives 0.6×, a
  // fully-rested elite crew gives ~1.6×. Surfaced here so players can see
  // whether a hire actually moves the needle.
  const currentService = computeServiceQuality(activeSection.people);
  const currentMult = serviceToConvMultiplier(currentService);

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
        subtitle={`Band ${formatMoney(band)}/hr · Service ${(currentService * 100).toFixed(0)}% → ×${currentMult.toFixed(2)} conversion · Above-band lifts morale, layoffs ding it`}
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
            // v0.8.1: preview what hiring this applicant would do to the
            // staffing-derived conversion multiplier. New hires start at
            // morale 72 (matches buildStaffRecord).
            const afterService = previewServiceAfterHire(
              activeSection.people,
              a.aptitude,
            );
            const afterMult = serviceToConvMultiplier(afterService);
            const convDeltaPct = ((afterMult - currentMult) / Math.max(0.0001, currentMult)) * 100;
            const deltaTone =
              convDeltaPct >= 1
                ? "text-money"
                : convDeltaPct <= -1
                  ? "text-loss"
                  : "text-ink-500";
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
                  <div className="text-[11px] text-ink-500 mt-0.5">
                    Hiring →{" "}
                    <span className="text-ink-300">
                      Service {(currentService * 100).toFixed(0)}% → {(afterService * 100).toFixed(0)}%
                    </span>{" "}
                    <span className={deltaTone}>
                      ({convDeltaPct >= 0 ? "+" : ""}
                      {convDeltaPct.toFixed(1)}% conversion)
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

// ===== Marketing tab (v0.10 channelized) =====

/**
 * Marketing tab — v0.10 "Marketing & Levers".
 *
 * Six per-channel sliders (radio / social / TV / magazines / OOH / email),
 * each with a demographic-fit badge for the current market and a live
 * decayed-score bar. The header card surfaces the market-weighted
 * effective score (what the engine actually uses in conversion &
 * pipeline formulas) and total weekly spend.
 *
 * Writes land via the `setBusinessMarketingChannel` store action, which
 * lazily seeds `LeverState` if the business predates v0.10. Engine tick
 * picks up the new spend immediately on the next hour.
 */
function MarketingTab({ biz }: { biz: Business }) {
  const market = useGameStore(
    (s) => s.game!.markets[biz.locationId],
  ) as Market | undefined;
  const setChannel = useGameStore((s) => s.setBusinessMarketingChannel);

  const levers = leversOf(biz);
  const totalWeekly = totalWeeklyMarketing(levers);
  const effectiveScore = market
    ? effectiveMarketingScore(levers, market)
    : 0;

  const demo = market
    ? (market.demographics ?? getMarketDemographics(market.id))
    : undefined;

  return (
    <div className="space-y-4">
      <Card
        title="Weekly marketing budget"
        subtitle={
          market
            ? `Effective reach for ${market.name} — weighted across all channels`
            : "Channelized spend (v0.10)"
        }
      >
        <div className="flex items-end justify-between mb-2">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wide">
              Total weekly spend
            </div>
            <div className="text-3xl font-bold text-ink-50 font-mono tabular-nums">
              {formatMoney(totalWeekly, { compact: true })}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-ink-400 uppercase tracking-wide">
              Effective reach
            </div>
            <div className="text-2xl font-bold text-ink-50 font-mono tabular-nums">
              {(effectiveScore * 100).toFixed(0)}%
            </div>
          </div>
        </div>
        <ScoreBar value={effectiveScore} tone="accent" />
        <p className="text-[11px] text-ink-400 mt-2 leading-relaxed">
          Each channel reaches a different age / income profile. Effective
          reach is the best-matched channel's decayed score, demographically
          weighted against this market. Stop spending and scores decay toward
          zero — fast for email, slower for print/OOH.
        </p>
      </Card>

      {demo && (
        <Card
          title="Market audience"
          subtitle={market!.name}
        >
          <div className="grid grid-cols-2 gap-2 text-xs">
            <DemoStat
              label="Age skew"
              value={demo.ageSkew}
              lowLabel="young"
              highLabel="older"
            />
            <DemoStat
              label="Income skew"
              value={demo.incomeSkew}
              lowLabel="price-led"
              highLabel="affluent"
            />
          </div>
          <div className="mt-2 text-[11px] text-ink-400">
            Median age{" "}
            <span className="text-ink-100 font-mono">
              {Math.round(demo.medianAge)}
            </span>{" "}
            · median HH income{" "}
            <span className="text-ink-100 font-mono">
              {formatMoney(demo.medianIncome, { compact: true })}
            </span>
          </div>
        </Card>
      )}

      <Card
        title="Channels"
        subtitle="Tune weekly spend per channel"
      >
        <div className="flex flex-col gap-3">
          {MARKETING_CHANNEL_IDS.map((ch) => (
            <MarketingChannelRow
              key={ch}
              channel={ch}
              weeklySpend={levers.marketingByChannel[ch]}
              score={levers.marketingScoreByChannel[ch]}
              demo={demo}
              onChange={(next) => setChannel(biz.id, ch, next)}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------- Marketing tab subcomponents ----------

function ScoreBar({
  value,
  tone = "accent",
}: {
  value: number; // 0..1
  tone?: "accent" | "money" | "ink";
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const toneClass =
    tone === "money"
      ? "bg-money"
      : tone === "ink"
        ? "bg-ink-500"
        : "bg-accent";
  return (
    <div className="h-1.5 w-full rounded-full bg-ink-800 overflow-hidden">
      <div
        className={`h-full rounded-full ${toneClass} transition-[width]`}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}

function DemoStat({
  label,
  value, // -1..+1
  lowLabel,
  highLabel,
}: {
  label: string;
  value: number;
  lowLabel: string;
  highLabel: string;
}) {
  const pct = Math.max(0, Math.min(1, (value + 1) / 2));
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-2">
      <div className="flex items-center justify-between text-[11px] text-ink-400">
        <span>{label}</span>
        <span className="font-mono text-ink-200">{value.toFixed(2)}</span>
      </div>
      <div className="mt-1 relative h-1.5 w-full rounded-full bg-ink-800 overflow-hidden">
        <div
          className="absolute top-0 h-full w-0.5 bg-accent"
          style={{ left: `${pct * 100}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-ink-500">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

/**
 * Per-channel slider row. Shows:
 *   · icon + channel name + fit badge for the active market
 *   · weekly-spend slider (0..2× saturation, rounded to $10)
 *   · current decayed score bar
 *   · helper text linking spend level to saturation
 */
function MarketingChannelRow({
  channel,
  weeklySpend,
  score,
  demo,
  onChange,
}: {
  channel: MarketingChannel;
  weeklySpend: Cents;
  score: number;
  demo:
    | { ageSkew: number; incomeSkew: number; medianAge: number; medianIncome: Cents }
    | undefined;
  onChange: (nextCents: Cents) => void;
}) {
  const profile = MARKETING_CHANNELS[channel];
  const saturation = profile.saturationCentsPerWeek;
  const max = saturation * 2; // slider ceiling
  const step = Math.max(1000, Math.round(saturation / 50)); // ≥ $10 steps
  const ratio = saturation > 0 ? Math.min(1, weeklySpend / saturation) : 0;
  const activelySpending = weeklySpend >= profile.minWeeklyCents;

  // Demographic fit for the current market, 0..1. Matches the engine's
  // weighting in `effectiveMarketingScore` so the UI hint is consistent
  // with what the tick actually credits.
  const fit = demo
    ? 0.5 +
      (1 - Math.abs(profile.ageReach - demo.ageSkew) / 2) * 0.25 +
      (1 - Math.abs(profile.incomeReach - demo.incomeSkew) / 2) * 0.25
    : 0.5;
  const fitLabel =
    fit >= 0.9
      ? "Great fit"
      : fit >= 0.8
        ? "Good fit"
        : fit >= 0.65
          ? "OK fit"
          : "Poor fit";
  const fitTone =
    fit >= 0.9
      ? "bg-money/20 text-money border-money/40"
      : fit >= 0.8
        ? "bg-accent/20 text-accent border-accent/40"
        : fit >= 0.65
          ? "bg-ink-700 text-ink-200 border-ink-600"
          : "bg-loss/15 text-loss border-loss/40";

  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-ink-50 flex items-center gap-2">
            <span>{profile.icon}</span>
            <span className="font-medium">{profile.displayName}</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border ${fitTone}`}
              title={`Demographic match vs market: ${(fit * 100).toFixed(0)}%`}
            >
              {fitLabel}
            </span>
          </div>
          <div className="text-[11px] text-ink-400 mt-0.5 leading-snug">
            {profile.description}
          </div>
        </div>
        <div className="text-right font-mono tabular-nums text-sm text-ink-50 shrink-0">
          {formatMoney(weeklySpend, { compact: true })}
          <div className="text-[10px] text-ink-400 font-mono">
            / wk
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={max}
          step={step}
          value={weeklySpend}
          onChange={(e) => onChange(Number(e.target.value) as Cents)}
          className="flex-1 accent-amber-400"
          aria-label={`${profile.displayName} weekly spend`}
        />
        <button
          className="text-[11px] text-ink-400 hover:text-ink-100 underline"
          onClick={() => onChange(0 as Cents)}
          type="button"
        >
          Zero
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-ink-500">
        <span>$0</span>
        <span>
          Min{" "}
          <span className="text-ink-300 font-mono">
            {formatMoney(profile.minWeeklyCents, { compact: true })}
          </span>
          {" · "}Sat{" "}
          <span className="text-ink-300 font-mono">
            {formatMoney(saturation, { compact: true })}
          </span>
        </span>
        <span>{formatMoney(max, { compact: true })}</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-ink-400">Saturation</div>
          <div className="text-ink-100 font-mono">
            {(ratio * 100).toFixed(0)}%
          </div>
        </div>
        <div>
          <div className="text-ink-400">Reach score</div>
          <div className="text-ink-100 font-mono">
            {(score * 100).toFixed(0)}%
          </div>
        </div>
        <div>
          <div className="text-ink-400">Below minimum</div>
          <div
            className={
              activelySpending ? "text-money font-mono" : "text-loss font-mono"
            }
          >
            {activelySpending ? "Active" : "Below min"}
          </div>
        </div>
      </div>
      <div className="mt-2">
        <ScoreBar
          value={score}
          tone={score >= 0.4 ? "money" : score >= 0.15 ? "accent" : "ink"}
        />
      </div>
    </div>
  );
}

// ===== Hours tab =====

const DAY_LABELS: Record<DayOfWeek, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

const DAY_LABELS_FULL: Record<DayOfWeek, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

const DAYS_IN_WEEK: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0]; // Mon-first layout

function formatHour(h: number): string {
  if (h === 0 || h === 24) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

function summarizeDay(v: DayHoursValue): string {
  if (v === "closed") return "Closed";
  if (v === "24h") return "24 hrs";
  return `${formatHour(v.open)} – ${formatHour(v.close)}`;
}

function HoursTab({ biz }: { biz: Business }) {
  const setDayHours = useGameStore((s) => s.setBusinessDayHours);
  const setSchedule = useGameStore((s) => s.setBusinessHoursSchedule);

  const levers = leversOf(biz);
  const schedule = levers.hours;

  const weeklyHours = scheduledHoursPerWeek(schedule);
  const laborMul = laborHoursMultiplier(schedule);
  const csatBonus = hoursCsatBonus(schedule);

  // Reference labor multiplier is "9am-9pm 7 days/week" (84 hrs reference).
  // laborMul > 1 means you're open more hours than the reference (or running
  // graveyard shifts). < 1 means a shorter workweek.
  const laborVsRefPct = (laborMul - 1) * 100;

  const kind = leverKindFor(biz.type);

  const presets: Array<{ label: string; schedule: HoursSchedule; hint: string }> = [
    {
      label: "Retail 9-9",
      schedule: defaultRetailHours(),
      hint: "Open 9am – 9pm, seven days",
    },
    {
      label: "Hospitality",
      schedule: defaultHospitalityHours(),
      hint: "Later close Fri/Sat",
    },
    {
      label: "24/7",
      schedule: allHours(),
      hint: "Always open — +2 CSAT, max labor cost",
    },
  ];

  return (
    <div className="space-y-4">
      <Card
        title="Hours of operation"
        subtitle={
          kind === "alwaysOn"
            ? "This business type is designed to run 24/7. Closing hours here will cut revenue."
            : "Open hours gate revenue. Shorter weeks cut labor cost; graveyard shifts (before 6am / after 10pm) pay a 1.25× wage premium."
        }
      >
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-2">
            <div className="text-[11px] text-ink-400 uppercase tracking-wide">
              Weekly hours
            </div>
            <div className="text-xl font-bold text-ink-50 font-mono tabular-nums">
              {weeklyHours}
              <span className="text-[11px] text-ink-400 font-normal"> / 168</span>
            </div>
          </div>
          <div className="rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-2">
            <div className="text-[11px] text-ink-400 uppercase tracking-wide">
              Labor cost
            </div>
            <div
              className={
                "text-xl font-bold font-mono tabular-nums " +
                (laborVsRefPct > 5
                  ? "text-loss"
                  : laborVsRefPct < -5
                    ? "text-money"
                    : "text-ink-50")
              }
            >
              {laborVsRefPct >= 0 ? "+" : ""}
              {laborVsRefPct.toFixed(0)}%
            </div>
            <div className="text-[10px] text-ink-500 mt-0.5">vs 9-9 daily ref</div>
          </div>
          <div className="rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-2">
            <div className="text-[11px] text-ink-400 uppercase tracking-wide">
              CSAT bonus
            </div>
            <div
              className={
                "text-xl font-bold font-mono tabular-nums " +
                (csatBonus > 0 ? "text-money" : "text-ink-50")
              }
            >
              {csatBonus > 0 ? `+${csatBonus}` : "0"}
            </div>
            <div className="text-[10px] text-ink-500 mt-0.5">
              {csatBonus === 2
                ? "24/7 bonus"
                : csatBonus === 1
                  ? "≥140 hrs/wk"
                  : "no bonus"}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Quick presets" subtitle="Overwrites every day">
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setSchedule(biz.id, p.schedule)}
              className="text-xs px-3 py-1.5 rounded-lg border border-ink-700 bg-ink-900/40 hover:border-accent hover:text-ink-50 text-ink-200 transition-colors"
              title={p.hint}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-400 mt-2">
          Engine picks up schedule edits on the next hour — no restart needed.
        </p>
      </Card>

      <Card title="Schedule" subtitle="Per-day open / close hours">
        <div className="flex flex-col gap-2">
          {DAYS_IN_WEEK.map((d) => (
            <DayHoursRow
              key={d}
              day={d}
              value={schedule[d]}
              onChange={(next) => setDayHours(biz.id, d, next)}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function DayHoursRow({
  day,
  value,
  onChange,
}: {
  day: DayOfWeek;
  value: DayHoursValue;
  onChange: (next: DayHoursValue) => void;
}) {
  const isClosed = value === "closed";
  const is247 = value === "24h";
  const isRange = !isClosed && !is247;

  // The open/close pickers drive a fresh DayHours object; toggling Closed
  // or 24h replaces the whole value. Re-entering "Range" restores 9-21.
  const range: { open: number; close: number } = isRange
    ? value
    : { open: 9, close: 21 };

  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-sm font-semibold text-ink-50 w-[88px] shrink-0">
            {DAY_LABELS_FULL[day]}
          </div>
          <div className="text-[11px] text-ink-400 font-mono">
            {summarizeDay(value)}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <ModeButton
            active={isRange}
            onClick={() => onChange({ open: range.open, close: range.close })}
            label="Range"
          />
          <ModeButton
            active={is247}
            onClick={() => onChange("24h")}
            label="24h"
          />
          <ModeButton
            active={isClosed}
            onClick={() => onChange("closed")}
            label="Closed"
          />
        </div>
      </div>

      {isRange && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-ink-400">
              Open
            </span>
            <select
              value={range.open}
              onChange={(e) => {
                const open = Number(e.target.value);
                const close = Math.max(open + 1, Math.min(24, range.close));
                onChange({ open, close });
              }}
              className="bg-ink-900 border border-ink-700 rounded-md px-2 py-1 text-sm text-ink-50 focus:border-accent focus:outline-none"
              aria-label={`${DAY_LABELS[day]} open hour`}
            >
              {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                <option key={h} value={h}>
                  {formatHour(h)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-ink-400">
              Close
            </span>
            <select
              value={range.close}
              onChange={(e) => {
                const close = Number(e.target.value);
                const open = Math.min(range.open, Math.max(0, close - 1));
                onChange({ open, close });
              }}
              className="bg-ink-900 border border-ink-700 rounded-md px-2 py-1 text-sm text-ink-50 focus:border-accent focus:outline-none"
              aria-label={`${DAY_LABELS[day]} close hour`}
            >
              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {formatHour(h)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "text-[11px] px-2 py-1 rounded border transition-colors " +
        (active
          ? "border-accent bg-accent/15 text-accent"
          : "border-ink-700 bg-ink-900/40 text-ink-300 hover:text-ink-100 hover:border-ink-500")
      }
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

// ===== Finance tab =====

function FinanceTab({ biz }: { biz: Business }) {
  const game = useGameStore((s) => s.game)!;
  const hostedProperty = useHostedProperty(biz);
  const [banner, setBanner] = useState<string | undefined>();
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

  const rentMonthly = readRentMonthly(biz);
  const rentWeeklyDraw =
    rentMonthly !== undefined ? Math.round(rentMonthly / 4) : undefined;

  return (
    <div className="space-y-4">
      {banner && (
        <div
          className="rounded-xl border border-ink-700 bg-ink-900/60 text-sm text-ink-50 px-3 py-2"
          role="status"
        >
          {banner}
        </div>
      )}

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

      {!hostedProperty && rentMonthly !== undefined && rentMonthly > 0 && (
        <ConvertToOwnedCard biz={biz} onResult={setBanner} />
      )}

      {rentMonthly !== undefined && (
        <Card
          title="Occupancy"
          subtitle={
            hostedProperty
              ? "You own the building."
              : "Leased commercial space."
          }
        >
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div
              className="rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-2"
              title={
                hostedProperty
                  ? "You own the building. No rent, but property taxes + maintenance still apply — they show up on the monthly personal ledger, not the business weekly."
                  : "Rent is drawn weekly from the business's operating cash at this monthly rate ÷ 4."
              }
            >
              <div className="text-ink-400">Rent</div>
              <div className="text-ink-50 font-mono">
                {hostedProperty
                  ? "$0"
                  : formatMoney(rentMonthly, { compact: true }) + "/mo"}
              </div>
              <div className="text-[10px] text-ink-500 mt-0.5">
                {hostedProperty
                  ? "Owned — no rent draw"
                  : `≈ ${formatMoney(rentWeeklyDraw ?? 0, { compact: true })} weekly draw`}
              </div>
            </div>
            {hostedProperty && (
              <Link
                to="/finance"
                className="rounded-lg border border-money/60 bg-money/10 px-3 py-2 hover:bg-money/15 transition-colors"
                title="You own the building hosting this business. Taxes and maintenance still apply at the monthly settlement."
              >
                <div className="text-money">🏠 Owned property</div>
                <div className="text-ink-50 font-mono text-xs truncate">
                  {hostedProperty.address}
                </div>
                <div className="text-[10px] text-ink-500 mt-0.5">
                  Maintenance{" "}
                  {formatMoney(hostedProperty.maintenanceMonthlyCents, {
                    compact: true,
                  })}
                  /mo · view in Finance
                </div>
              </Link>
            )}
          </div>
        </Card>
      )}

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
