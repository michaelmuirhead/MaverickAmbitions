/**
 * Real Estate Firm — portfolio of properties, flips + rentals + mgmt fees.
 *
 * Distinctive mechanics:
 *   - No hourly foot traffic. The simulation moves on the weekly tick:
 *     appreciation, rent collection, flip exits.
 *   - Two property types:
 *       * MANAGE — hold indefinitely, collect monthly rent when occupied.
 *         Every month a vacancy roll determines occupancy for the next.
 *         Revenue is split: tenant rent → `rent_income`, internal
 *         management fee → `property_management_fee`.
 *       * FLIP — hold for ~8–20 weeks, property value drifts upward
 *         (with some chance of slippage); sell at end for `flip_gain`
 *         relative to purchase + renovation cost.
 *   - Weekly acquisition pipeline adds ~0.3-0.5 properties/week on
 *     average (prestige-scaled), up to a portfolio cap.
 *
 * $280K startup, unlocks at $220K NW.
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

import {
  effectiveMarketingScore,
  leversOf,
  totalWeeklyMarketing,
} from "./leverState";

import type {
  BusinessStartupSpec,
  BusinessTickContext,
  BusinessTickResult,
  BusinessTypeModule,
  BusinessUiDescriptor,
} from "./types";

// ---------- State ----------

export type PropertyHoldType = "flip" | "manage";

export interface Property {
  id: Id;
  label: string;
  holdType: PropertyHoldType;
  purchasePriceCents: Cents;
  renovationCostCents: Cents;
  /** Current appraisal value in cents. */
  currentValueCents: Cents;
  /** Monthly rent if managed & occupied (cents). 0 for flips. */
  monthlyRentCents: Cents;
  /** Occupancy flag for managed properties. */
  occupied: boolean;
  /** Absolute tick the firm acquired this property. */
  acquiredAtTick: Tick;
  /** For flips: target hold in weeks. */
  flipTargetWeeks: number;
  /** For flips: expected appreciation at target (0..0.5). */
  flipTargetAppreciation: number;
}

interface ReAgent {
  id: Id;
  name: string;
  role: "broker" | "agent" | "assistant";
  hourlyWageCents: Cents;
  skill: number;
  morale: number;
}

export interface RealEstateState {
  portfolio: Property[];
  agents: ReAgent[];
  /** Portfolio cap — bigger as firm grows (UI upgrades later). */
  portfolioCap: number;
  rentMonthly: Cents; // office rent
  prestige: number;

  // accumulators
  weeklyRentAcc: Cents;
  weeklyMgmtFeeAcc: Cents;
  weeklyFlipGainAcc: Cents;
  weeklyAcquisitionAcc: Cents;
  weeklyRenovationAcc: Cents;
  wagesAccrued: Cents;
}

// ---------- UI / startup ----------

const ui: BusinessUiDescriptor = {
  label: "Real Estate Firm",
  icon: "🏢",
  kpiLabels: ["Weekly Profit", "Portfolio Size", "Prestige", "Flip Gain"],
  sections: ["portfolio", "staff", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(280_000),
  minimumCreditScore: 700,
  unlocksAt: { netWorthCents: dollars(220_000) },
};

const PROPERTY_LABELS = [
  "Maple Street Duplex",
  "Lakeside Cottage",
  "Hilltop Colonial",
  "Riverfront Loft",
  "Oakridge Bungalow",
  "Elm Row Townhouse",
  "Highlands Estate",
  "Downtown Condo",
  "Harborview Flat",
  "Parkside Brownstone",
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
  const state: RealEstateState = {
    portfolio: [],
    agents: [
      { id: `${params.id}-br1`, name: "Managing Broker",  role: "broker",    hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 2.2), skill: 70, morale: 72 },
      { id: `${params.id}-ag1`, name: "Sales Agent Alpha", role: "agent",     hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.5), skill: 55, morale: 70 },
      { id: `${params.id}-ag2`, name: "Sales Agent Beta",  role: "agent",     hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.5), skill: 55, morale: 70 },
      { id: `${params.id}-as1`, name: "Office Assistant", role: "assistant", hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.0), skill: 45, morale: 66 },
    ],
    portfolioCap: 12,
    rentMonthly: Math.round(ECONOMY.BASE_RENT_MONTHLY_CENTS * 1.5),
    prestige: 0.25,

    weeklyRentAcc: 0,
    weeklyMgmtFeeAcc: 0,
    weeklyFlipGainAcc: 0,
    weeklyAcquisitionAcc: 0,
    weeklyRenovationAcc: 0,
    wagesAccrued: 0,
  };

  const kpis: BusinessKPIs = {
    weeklyRevenue: 0,
    weeklyExpenses: 0,
    weeklyProfit: 0,
    marketShare: 0.08,
    customerSatisfaction: 68,
  };

  const derived: BusinessDerived = {
    footTraffic: 0,
    stockLevel: 1,
    pendingWages: 0,
    riskScore: 22,
  };

  return {
    id: params.id,
    ownerId: params.ownerId,
    type: "real_estate_firm",
    name: params.name,
    locationId: params.locationId,
    openedAtTick: params.tick,
    cash: dollars(45_000),
    state: state as unknown as Record<string, unknown>,
    kpis,
    derived,
  };
}

// ---------- Simulation ----------

function getState(biz: Business): RealEstateState {
  return structuredClone(biz.state) as unknown as RealEstateState;
}

function onHour(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  // Hourly is dull; just accrue agent wages during office hours.
  if (state.agents.length > 0) {
    const h = Math.floor(ctx.tick) % 24;
    if (h >= 9 && h <= 18) {
      state.wagesAccrued += state.agents.reduce((a, s) => a + s.hourlyWageCents, 0);
    }
  }
  return {
    business: updateDerivedOnly(biz, state),
    ledger: [],
    events: [],
  };
}

function onDay(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);

  // Drift agents.
  for (const a of state.agents) {
    a.morale = Math.max(0, Math.min(100, a.morale + ctx.rng.nextFloat(-2, 2)));
    a.skill = Math.min(100, a.skill + ctx.rng.nextFloat(0, 0.15));
  }

  // Property value drift — daily small appreciation or depreciation.
  for (const p of state.portfolio) {
    const dailyDrift = ctx.rng.nextFloat(-0.0008, 0.0018);
    p.currentValueCents = Math.round(p.currentValueCents * (1 + dailyDrift));
  }

  return {
    business: { ...biz, state: state as unknown as Record<string, unknown> },
    ledger: [],
    events: [],
  };
}

function onWeek(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];
  let cash = biz.cash;
  const marketingScore = effectiveMarketingScore(
    leversOf(biz),
    ctx.world.markets[biz.locationId],
  );

  // Monthly occupancy flip for managed properties (rolled every 4 weeks).
  const weekIndex = Math.floor(ctx.tick / (24 * 7));
  if (weekIndex % 4 === 0) {
    for (const p of state.portfolio) {
      if (p.holdType !== "manage") continue;
      // 85% chance of staying occupied if currently occupied;
      // 35% chance of being leased if currently vacant.
      if (p.occupied) {
        p.occupied = ctx.rng.chance(0.85);
      } else {
        p.occupied = ctx.rng.chance(0.35 + marketingScore * 0.2);
      }
    }
  }

  // Rent collection (monthly = every 4 weeks for simplicity; paid on weekly tick
  // split into weekly fraction for continuous cash).
  for (const p of state.portfolio) {
    if (p.holdType === "manage" && p.occupied && p.monthlyRentCents > 0) {
      const weeklyRentFraction = Math.round(p.monthlyRentCents / 4);
      cash += weeklyRentFraction;
      ledgerEntries.push(
        ledger(
          `rentin-${biz.id}-${ctx.tick}-${p.id}`,
          ctx.tick,
          weeklyRentFraction,
          "rent_income",
          `Rent: ${p.label}`,
          biz.id,
        ),
      );
      state.weeklyRentAcc += weeklyRentFraction;

      // Management fee on the rent — 8% of collected rent.
      const mgmtFee = Math.round(weeklyRentFraction * 0.08);
      // Inside the firm this is effectively a book entry (cash is already
      // counted), so book it as property_management_fee and let accounting
      // view surface it distinctly from raw rent.
      ledgerEntries.push(
        ledger(
          `mgmt-${biz.id}-${ctx.tick}-${p.id}`,
          ctx.tick,
          0, // cash-neutral; it's already inside the rent line
          "property_management_fee",
          `Mgmt fee: ${p.label}`,
          biz.id,
        ),
      );
      state.weeklyMgmtFeeAcc += mgmtFee;
    }
  }

  // Flip exits — if any flip has hit its target hold window, sell.
  for (const p of state.portfolio) {
    if (p.holdType !== "flip") continue;
    const weeksHeld = (ctx.tick - p.acquiredAtTick) / (24 * 7);
    if (weeksHeld >= p.flipTargetWeeks) {
      // Actual exit value is target appreciation ± variance.
      const variance = ctx.rng.nextFloat(-0.08, 0.12);
      const totalAppreciation = p.flipTargetAppreciation + variance;
      const basis = p.purchasePriceCents + p.renovationCostCents;
      const exitPrice = Math.round(basis * (1 + totalAppreciation));
      const gain = exitPrice - basis;
      cash += exitPrice;
      ledgerEntries.push(
        ledger(
          `sale-${biz.id}-${ctx.tick}-${p.id}`,
          ctx.tick,
          exitPrice,
          "flip_gain",
          `Sold: ${p.label}`,
          biz.id,
        ),
      );
      state.weeklyFlipGainAcc += gain;
      if (gain > 0) {
        state.prestige = Math.min(1, state.prestige + 0.01 + gain / dollars(1_000_000) * 0.02);
      } else {
        state.prestige = Math.max(0, state.prestige - 0.02);
      }
      events.push({
        kind: "business_event",
        title: `${biz.name} flipped ${p.label}`,
        detail: `Exit ${gain >= 0 ? "+" : "-"}$${Math.round(Math.abs(gain) / 100).toLocaleString()} on a $${Math.round(basis / 100).toLocaleString()} basis.`,
      });
    }
  }
  // Remove sold flips from portfolio.
  state.portfolio = state.portfolio.filter(
    (p) =>
      !(
        p.holdType === "flip" &&
        (ctx.tick - p.acquiredAtTick) / (24 * 7) >= p.flipTargetWeeks
      ),
  );

  // Acquisition pipeline — weekly chance to buy a new property.
  const acquireChance = Math.min(
    0.7,
    0.3 + state.prestige * 0.4 + marketingScore * 0.2,
  );
  const spaceLeft = state.portfolio.length < state.portfolioCap;
  if (spaceLeft && ctx.rng.chance(acquireChance)) {
    const holdType: PropertyHoldType = ctx.rng.chance(0.4) ? "flip" : "manage";
    const basePrice = dollars(
      180_000 + Math.round(ctx.rng.nextFloat(0, 1) * 420_000),
    );
    const renovation =
      holdType === "flip"
        ? Math.round(basePrice * ctx.rng.nextFloat(0.05, 0.18))
        : Math.round(basePrice * ctx.rng.nextFloat(0.0, 0.04));
    const cost = basePrice + renovation;

    if (cash >= cost) {
      cash -= cost;
      const label =
        PROPERTY_LABELS[ctx.rng.nextInt(0, PROPERTY_LABELS.length - 1)] ??
        "New Listing";
      const property: Property = {
        id: `prop-${ctx.tick}-${ctx.rng.nextInt(1000, 9999)}`,
        label,
        holdType,
        purchasePriceCents: basePrice,
        renovationCostCents: renovation,
        currentValueCents: basePrice + renovation,
        monthlyRentCents:
          holdType === "manage"
            ? Math.round(basePrice * 0.007) // ~0.7% monthly rent on price
            : 0,
        occupied: holdType === "manage" ? ctx.rng.chance(0.6) : false,
        acquiredAtTick: ctx.tick,
        flipTargetWeeks: holdType === "flip" ? ctx.rng.nextInt(8, 20) : 0,
        flipTargetAppreciation:
          holdType === "flip" ? ctx.rng.nextFloat(0.12, 0.28) : 0,
      };
      state.portfolio.push(property);
      state.weeklyAcquisitionAcc += basePrice;
      state.weeklyRenovationAcc += renovation;
      ledgerEntries.push(
        ledger(
          `acq-${biz.id}-${ctx.tick}-${property.id}`,
          ctx.tick,
          -cost,
          "other",
          `Acquired ${label} (${holdType})`,
          biz.id,
        ),
      );
      events.push({
        kind: "business_event",
        title: `${biz.name} acquired ${label}`,
        detail:
          holdType === "flip"
            ? `Flip target ${property.flipTargetWeeks}w @ +${Math.round(property.flipTargetAppreciation * 100)}%.`
            : `Rental at $${Math.round(property.monthlyRentCents / 100).toLocaleString()}/mo.`,
      });
    }
  }

  // Wages + rent + marketing.
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

  const weeklyOfficeRent = Math.round(state.rentMonthly / 4);
  cash -= weeklyOfficeRent;
  ledgerEntries.push(
    ledger(
      `rent-${biz.id}-${ctx.tick}`,
      ctx.tick,
      -weeklyOfficeRent,
      "rent",
      "Weekly office rent",
      biz.id,
    ),
  );

  const weeklyMarketing = totalWeeklyMarketing(leversOf(biz));
  if (weeklyMarketing > 0) {
    cash -= weeklyMarketing;
    ledgerEntries.push(
      ledger(
        `mkt-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -weeklyMarketing,
        "marketing",
        "Listings / portal fees",
        biz.id,
      ),
    );
  }

  const weeklyRevenue = state.weeklyRentAcc + state.weeklyFlipGainAcc;
  const weeklyExpenses = state.wagesAccrued + weeklyOfficeRent + weeklyMarketing;
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

  // CSAT nudge.
  const target =
    50 + state.prestige * 30 + marketingScore * 10;
  const next =
    biz.kpis.customerSatisfaction +
    (Math.max(0, Math.min(90, target)) - biz.kpis.customerSatisfaction) * 0.15;

  // Reset.
  state.weeklyRentAcc = 0;
  state.weeklyMgmtFeeAcc = 0;
  state.weeklyFlipGainAcc = 0;
  state.weeklyAcquisitionAcc = 0;
  state.weeklyRenovationAcc = 0;
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
        footTraffic: state.portfolio.length,
        pendingWages: 0,
      },
    },
    ledger: ledgerEntries,
    events,
  };
}

function updateDerivedOnly(biz: Business, state: RealEstateState): Business {
  return {
    ...biz,
    state: state as unknown as Record<string, unknown>,
    derived: {
      ...biz.derived,
      footTraffic: state.portfolio.length,
      pendingWages: state.wagesAccrued,
    },
  };
}

// ---------- Module ----------

export const realEstateFirmModule: BusinessTypeModule = {
  id: "real_estate_firm",
  ui,
  startup,
  create: createBusiness,
  onHour,
  onDay,
  onWeek,
};
