/**
 * Oil & Gas — well-by-well extraction, commodity spot pricing, depletion.
 *
 * Distinctive mechanics:
 *   - Production happens per-well, daily. Each well has:
 *       * dailyProductionBbl — starts high, declines weekly.
 *       * declinePerWeek — fraction depleted per week.
 *       * reserveBbl — total barrels remaining (hard cap).
 *   - Each week, a commodity spot price fluctuates (random walk around
 *     $72/bbl, clamped $45..$110). Revenue = bbl × price, booked as
 *     `commodity_sale`.
 *   - New wells cost `drilling_capex` up front; some hit (yield a
 *     productive well), some miss (lose the capex, no production).
 *   - Once a well's reserve hits zero, it's retired.
 *
 * $450K startup, unlocks at $380K NW.
 */

import type {
  Business,
  BusinessDerived,
  BusinessKPIs,
  Cents,
  Id,
  LedgerEntry,
  Tick,
} from "@/types/game";

import { dollars } from "@/lib/money";

import { ECONOMY } from "../economy/constants";
import { corporateTax, ledger } from "../economy/finance";

import type {
  BusinessStartupSpec,
  BusinessTickContext,
  BusinessTickResult,
  BusinessTypeModule,
  BusinessUiDescriptor,
} from "./types";

// ---------- State ----------

export interface Well {
  id: Id;
  name: string;
  /** Barrels per day at current decline state. */
  dailyProductionBbl: number;
  /** Initial production for KPI reference. */
  initialDailyBbl: number;
  /** Fraction per WEEK that production declines (e.g. 0.05 = 5%/wk). */
  declinePerWeek: number;
  /** Total remaining barrels. Well goes dead at 0. */
  reserveBbl: number;
  /** Absolute tick drilled. */
  drilledAtTick: Tick;
  /** Flavor tag. */
  label: string;
  /** Whether well actually produces (drilling can hit a dry hole). */
  productive: boolean;
}

interface RigStaff {
  id: Id;
  name: string;
  role: "driller" | "operator" | "engineer" | "admin";
  hourlyWageCents: Cents;
  skill: number;
  morale: number;
}

export interface OilGasState {
  wells: Well[];
  staff: RigStaff[];
  /** Current commodity spot price, cents per barrel. */
  spotPricePerBblCents: Cents;
  /** Lifting cost per barrel in cents (COGS). */
  liftingCostPerBblCents: Cents;
  /** Cap on simultaneous active wells. */
  wellCap: number;
  marketingScore: number; // BD for leases/permits
  marketingWeekly: Cents;
  rentMonthly: Cents;

  // accumulators
  weeklyProductionBbl: number;
  weeklyRevenueAcc: Cents;
  weeklyCogsAcc: Cents;
  weeklyCapexAcc: Cents;
  wagesAccrued: Cents;
}

// ---------- UI / startup ----------

const ui: BusinessUiDescriptor = {
  label: "Oil & Gas",
  icon: "🛢️",
  kpiLabels: ["Weekly Profit", "Barrels/Day", "Active Wells", "Spot Price"],
  sections: ["wells", "staff", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(450_000),
  minimumCreditScore: 720,
  unlocksAt: { netWorthCents: dollars(380_000) },
};

const WELL_LABELS = [
  "Bayou Bend #",
  "Prairie Ridge #",
  "North Pasture #",
  "Devil's Gulch #",
  "Sun Rim #",
  "Flat Creek #",
  "Chisholm #",
  "Red Iron #",
] as const;

// ---------- Factory ----------

function createBusiness(params: {
  id: Id;
  ownerId: Id;
  name: string;
  locationId: Id;
  tick: Tick;
  seed: string;
}): Business {
  const state: OilGasState = {
    wells: [],
    staff: [
      { id: `${params.id}-drl1`,  name: "Tool Pusher",      role: "driller",  hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 2.2), skill: 65, morale: 70 },
      { id: `${params.id}-drl2`,  name: "Derrick Hand",     role: "driller",  hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.8), skill: 55, morale: 68 },
      { id: `${params.id}-op1`,   name: "Pumper",           role: "operator", hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.5), skill: 50, morale: 68 },
      { id: `${params.id}-op2`,   name: "Pumper",           role: "operator", hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.5), skill: 50, morale: 68 },
      { id: `${params.id}-eng`,   name: "Reservoir Eng.",   role: "engineer", hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 2.6), skill: 70, morale: 72 },
      { id: `${params.id}-adm`,   name: "Land/Leases Adm.", role: "admin",    hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.4), skill: 55, morale: 68 },
    ],
    spotPricePerBblCents: dollars(72),
    liftingCostPerBblCents: dollars(18),
    wellCap: 6,
    marketingScore: 0.3,
    marketingWeekly: dollars(900),
    rentMonthly: Math.round(ECONOMY.BASE_RENT_MONTHLY_CENTS * 2.8),

    weeklyProductionBbl: 0,
    weeklyRevenueAcc: 0,
    weeklyCogsAcc: 0,
    weeklyCapexAcc: 0,
    wagesAccrued: 0,
  };

  const kpis: BusinessKPIs = {
    weeklyRevenue: 0,
    weeklyExpenses: 0,
    weeklyProfit: 0,
    marketShare: 0.05,
    customerSatisfaction: 62,
  };

  const derived: BusinessDerived = {
    footTraffic: 0,
    stockLevel: 1,
    pendingWages: 0,
    riskScore: 35,
  };

  return {
    id: params.id,
    ownerId: params.ownerId,
    type: "oil_gas",
    name: params.name,
    locationId: params.locationId,
    openedAtTick: params.tick,
    cash: dollars(85_000),
    state: state as unknown as Record<string, unknown>,
    kpis,
    derived,
  };
}

// ---------- Simulation ----------

function getState(biz: Business): OilGasState {
  return structuredClone(biz.state) as unknown as OilGasState;
}

function onHour(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  // Just accrue wages during ops hours (6am-22). Wells produce continuously;
  // production is booked on the daily tick.
  const h = ctx.tick % 24;
  if (h >= 6 && h <= 21 && state.staff.length > 0) {
    state.wagesAccrued += state.staff.reduce((a, s) => a + s.hourlyWageCents, 0);
  }
  return {
    business: updateDerivedOnly(biz, state),
    ledger: [],
    events: [],
  };
}

function onDay(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const ledgerEntries: LedgerEntry[] = [];
  let cash = biz.cash;

  // Drift staff.
  for (const s of state.staff) {
    s.morale = Math.max(0, Math.min(100, s.morale + ctx.rng.nextFloat(-2, 2)));
    s.skill = Math.min(100, s.skill + ctx.rng.nextFloat(0, 0.1));
  }

  let dayBbl = 0;
  for (const w of state.wells) {
    if (!w.productive || w.reserveBbl <= 0) continue;
    const produce = Math.min(w.dailyProductionBbl, w.reserveBbl);
    w.reserveBbl -= produce;
    dayBbl += produce;
  }
  const dayRevenue = Math.round(dayBbl * state.spotPricePerBblCents);
  const dayCogs = Math.round(dayBbl * state.liftingCostPerBblCents);

  if (dayRevenue > 0) {
    cash += dayRevenue;
    ledgerEntries.push(
      ledger(
        `sale-${biz.id}-${ctx.tick}`,
        ctx.tick,
        dayRevenue,
        "commodity_sale",
        `Wellhead sales (${Math.round(dayBbl)} bbl)`,
        biz.id,
      ),
    );
    state.weeklyRevenueAcc += dayRevenue;
  }
  if (dayCogs > 0) {
    cash -= dayCogs;
    ledgerEntries.push(
      ledger(
        `lift-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -dayCogs,
        "cogs",
        "Lifting cost",
        biz.id,
      ),
    );
    state.weeklyCogsAcc += dayCogs;
  }
  state.weeklyProductionBbl += dayBbl;

  // Retire depleted wells.
  state.wells = state.wells.filter(
    (w) => !(w.productive && w.reserveBbl <= 0),
  );

  return {
    business: {
      ...biz,
      cash,
      state: state as unknown as Record<string, unknown>,
    },
    ledger: ledgerEntries,
    events: [],
  };
}

function onWeek(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];
  let cash = biz.cash;

  // Commodity spot price random walk.
  const driftPct = ctx.rng.nextFloat(-0.08, 0.09);
  const nextPrice = Math.round(state.spotPricePerBblCents * (1 + driftPct));
  state.spotPricePerBblCents = Math.max(
    dollars(45),
    Math.min(dollars(110), nextPrice),
  );

  // Weekly decline on each producing well.
  for (const w of state.wells) {
    if (!w.productive) continue;
    w.dailyProductionBbl = Math.round(
      w.dailyProductionBbl * (1 - w.declinePerWeek),
    );
  }

  // Drilling opportunity — not every week, only when prestige + cash allow.
  const activeWells = state.wells.filter(
    (w) => w.productive && w.reserveBbl > 0,
  ).length;
  const shouldTryDrill =
    activeWells < state.wellCap && ctx.rng.chance(0.35);
  if (shouldTryDrill) {
    const capex = dollars(
      180_000 + Math.round(ctx.rng.nextFloat(0, 1) * 320_000),
    );
    if (cash >= capex) {
      cash -= capex;
      ledgerEntries.push(
        ledger(
          `capex-${biz.id}-${ctx.tick}`,
          ctx.tick,
          -capex,
          "drilling_capex",
          "Drilling capex",
          biz.id,
        ),
      );
      state.weeklyCapexAcc += capex;

      // 68% chance of hitting a productive well.
      const hit = ctx.rng.chance(0.68);
      const labelBase =
        WELL_LABELS[ctx.rng.nextInt(0, WELL_LABELS.length - 1)] ?? "Well #";
      const suffix = state.wells.length + 1;
      const name = `${labelBase}${suffix}`;

      if (hit) {
        // Production scales with how much capex was spent (bigger capex, better well).
        const capexTier = capex / dollars(500_000); // 0.36..1.0
        const initialBbl = Math.round(60 + ctx.rng.nextFloat(0, 1) * 140 * capexTier);
        const reserveBbl = Math.round(initialBbl * 180 * (0.7 + ctx.rng.nextFloat(0, 1) * 0.8));
        const well: Well = {
          id: `well-${ctx.tick}-${suffix}`,
          name,
          label: name,
          dailyProductionBbl: initialBbl,
          initialDailyBbl: initialBbl,
          declinePerWeek: ctx.rng.nextFloat(0.015, 0.05),
          reserveBbl,
          drilledAtTick: ctx.tick,
          productive: true,
        };
        state.wells.push(well);
        events.push({
          kind: "milestone",
          title: `${biz.name} struck producing well: ${name}`,
          detail: `~${initialBbl} bbl/day, reserves ~${Math.round(reserveBbl / 1000)}k bbl.`,
        });
      } else {
        const dry: Well = {
          id: `dry-${ctx.tick}-${suffix}`,
          name: `${name} (dry)`,
          label: `${name} (dry)`,
          dailyProductionBbl: 0,
          initialDailyBbl: 0,
          declinePerWeek: 0,
          reserveBbl: 0,
          drilledAtTick: ctx.tick,
          productive: false,
        };
        state.wells.push(dry);
        events.push({
          kind: "business_event",
          title: `${biz.name}: dry hole on ${name}`,
          detail: `Spent $${Math.round(capex / 100).toLocaleString()} on a non-producing well.`,
          impact: { reputationDelta: -1 },
        });
      }
    }
  }

  // Fixed costs.
  if (state.wagesAccrued > 0) {
    cash -= state.wagesAccrued;
    ledgerEntries.push(
      ledger(
        `wages-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -state.wagesAccrued,
        "wages",
        "Weekly wages",
        biz.id,
      ),
    );
  }

  const weeklyRent = Math.round(state.rentMonthly / 4);
  cash -= weeklyRent;
  ledgerEntries.push(
    ledger(
      `rent-${biz.id}-${ctx.tick}`,
      ctx.tick,
      -weeklyRent,
      "rent",
      "Weekly facility/lease",
      biz.id,
    ),
  );

  if (state.marketingWeekly > 0) {
    cash -= state.marketingWeekly;
    ledgerEntries.push(
      ledger(
        `mkt-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -state.marketingWeekly,
        "marketing",
        "Lease / permits BD",
        biz.id,
      ),
    );
    state.marketingScore = Math.min(
      1,
      state.marketingScore * 0.6 +
        Math.min(1, state.marketingWeekly / dollars(1_500)) * 0.4,
    );
  } else {
    state.marketingScore *= 0.6;
  }

  const weeklyRevenue = state.weeklyRevenueAcc;
  const weeklyExpenses =
    state.weeklyCogsAcc +
    state.weeklyCapexAcc +
    state.wagesAccrued +
    weeklyRent +
    state.marketingWeekly;
  const pretax = weeklyRevenue - weeklyExpenses;
  const tax = corporateTax(pretax);
  if (tax > 0) {
    cash -= tax;
    ledgerEntries.push(
      ledger(
        `tax-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -tax,
        "tax",
        "Weekly corporate tax",
        biz.id,
      ),
    );
  }
  const weeklyProfit = pretax - tax;

  // CSAT / "stakeholder" nudge — oil & gas is less customer-facing, track as prestige.
  const target = 50 + Math.min(30, state.wells.filter((w) => w.productive).length * 6);
  const next =
    biz.kpis.customerSatisfaction +
    (Math.max(0, Math.min(90, target)) - biz.kpis.customerSatisfaction) * 0.1;

  // Reset weekly accumulators.
  state.weeklyProductionBbl = 0;
  state.weeklyRevenueAcc = 0;
  state.weeklyCogsAcc = 0;
  state.weeklyCapexAcc = 0;
  state.wagesAccrued = 0;

  const kpis: BusinessKPIs = {
    ...biz.kpis,
    weeklyRevenue,
    weeklyExpenses,
    weeklyProfit,
    customerSatisfaction: next,
  };

  return {
    business: {
      ...biz,
      cash,
      state: state as unknown as Record<string, unknown>,
      kpis,
      derived: {
        ...biz.derived,
        footTraffic: state.wells.filter((w) => w.productive).length,
        pendingWages: 0,
      },
    },
    ledger: ledgerEntries,
    events,
  };
}

function updateDerivedOnly(biz: Business, state: OilGasState): Business {
  return {
    ...biz,
    state: state as unknown as Record<string, unknown>,
    derived: {
      ...biz.derived,
      pendingWages: state.wagesAccrued,
      footTraffic: state.wells.filter((w) => w.productive).length,
    },
  };
}

// ---------- Module ----------

export const oilGasModule: BusinessTypeModule = {
  id: "oil_gas",
  ui,
  startup,
  create: createBusiness,
  onHour,
  onDay,
  onWeek,
};
