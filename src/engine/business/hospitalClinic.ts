/**
 * Hospital / Clinic — 24/7 operations, insurance billing, malpractice risk.
 *
 * Distinctive mechanics:
 *   - Operates 24 hours/day. Patient flow is highest in day, but never
 *     zero (ER-style always-on).
 *   - Revenue flows in two streams:
 *       1. `insurance_billing` — lagged payout on the following week
 *          (insurance companies don't pay instantly).
 *       2. Cash pay copays — booked immediately as `revenue`.
 *   - Staff mix matters: clinicians > admin > support. Low clinician
 *     coverage raises wait times, drops CSAT, and raises malpractice
 *     risk on any given patient visit.
 *   - Rare catastrophic malpractice events roll against a very low
 *     per-visit probability, scaled by (1 - quality). When they hit,
 *     the settlement is booked as `malpractice_settlement` — a chunky
 *     negative ledger entry.
 *
 * $400K startup, unlocks at $320K NW — flagship medical.
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

import { getHours } from "date-fns";

import { tickToDate } from "@/lib/date";
import { dollars } from "@/lib/money";

import { ECONOMY } from "../economy/constants";
import { corporateTax, ledger } from "../economy/finance";
import { marketFootTraffic } from "../economy/market";

import type {
  BusinessStartupSpec,
  BusinessTickContext,
  BusinessTickResult,
  BusinessTypeModule,
  BusinessUiDescriptor,
} from "./types";

// ---------- State ----------

interface ClinicStaff {
  id: Id;
  name: string;
  role: "physician" | "nurse" | "admin" | "technician";
  hourlyWageCents: Cents;
  skill: number;
  morale: number;
}

export interface HospitalClinicState {
  staff: ClinicStaff[];
  /** Copay collected per visit (direct cash). */
  copayCents: Cents;
  /** Insurance billing per visit (lagged to next week's settlement). */
  insuranceBillingCents: Cents;
  /** COGS per visit (supplies, meds, consumables). */
  variableCostPerVisitCents: Cents;
  /** 0..1 care quality — lowers malpractice risk, raises CSAT. */
  careQuality: number;
  /** 0..1 marketing score (local ads, referrals). */
  marketingScore: number;
  marketingWeekly: Cents;
  rentMonthly: Cents;
  /** Insurance billings that are pending payout next week. */
  pendingInsuranceCents: Cents;

  // accumulators
  weeklyCopayAcc: Cents;
  weeklyInsurancePaidAcc: Cents;
  weeklyCogsAcc: Cents;
  weeklyMalpracticeAcc: Cents;
  wagesAccrued: Cents;
  weeklyVisitsAcc: number;
}

// ---------- UI / startup ----------

const ui: BusinessUiDescriptor = {
  label: "Clinic",
  icon: "🏥",
  kpiLabels: ["Weekly Profit", "Patient Visits", "Care Quality", "Settlements"],
  sections: ["clinicians", "staff", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(400_000),
  minimumCreditScore: 700,
  unlocksAt: { netWorthCents: dollars(320_000) },
};

// ---------- Helpers ----------

function hourOf(tick: Tick): number {
  return getHours(tickToDate(tick));
}

function hourTrafficCurve(h: number): number {
  // 24/7 but peaks midday; quiet at night but non-zero.
  if (h >= 9 && h <= 17) return 1.0;
  if (h >= 7 && h <= 21) return 0.65;
  if (h >= 22 || h <= 5) return 0.2;
  return 0.45;
}

function clinicianRatio(state: HospitalClinicState): number {
  const clinicians = state.staff.filter(
    (s) => s.role === "physician" || s.role === "nurse",
  ).length;
  const totalNeeded = 4; // baseline assumption for this size clinic
  return Math.min(1, clinicians / totalNeeded);
}

function avgClinicianSkill(state: HospitalClinicState): number {
  const clinicians = state.staff.filter(
    (s) => s.role === "physician" || s.role === "nurse",
  );
  if (clinicians.length === 0) return 0;
  return (
    clinicians.reduce((a, s) => a + (s.skill * s.morale) / 10000, 0) /
    clinicians.length
  );
}

// ---------- Factory ----------

function createBusiness(params: {
  id: Id;
  ownerId: Id;
  name: string;
  locationId: Id;
  tick: Tick;
  seed: string;
}): Business {
  const state: HospitalClinicState = {
    staff: [
      { id: `${params.id}-md1`,   name: "Dr. Moreau",        role: "physician",  hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 4.5), skill: 75, morale: 72 },
      { id: `${params.id}-md2`,   name: "Dr. Aziz",          role: "physician",  hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 4.2), skill: 70, morale: 70 },
      { id: `${params.id}-rn1`,   name: "RN Kate",           role: "nurse",      hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.9), skill: 65, morale: 70 },
      { id: `${params.id}-rn2`,   name: "RN Diego",          role: "nurse",      hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.8), skill: 60, morale: 68 },
      { id: `${params.id}-tec1`,  name: "Tech Maria",        role: "technician", hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.4), skill: 55, morale: 68 },
      { id: `${params.id}-adm1`,  name: "Admin Sarah",       role: "admin",      hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.2), skill: 50, morale: 66 },
      { id: `${params.id}-adm2`,  name: "Billing Sarah",     role: "admin",      hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.2), skill: 50, morale: 66 },
    ],
    copayCents: dollars(35),
    insuranceBillingCents: dollars(220),
    variableCostPerVisitCents: dollars(55),
    careQuality: 0.68,
    marketingScore: 0.25,
    marketingWeekly: dollars(600),
    rentMonthly: Math.round(ECONOMY.BASE_RENT_MONTHLY_CENTS * 3.5),
    pendingInsuranceCents: 0,

    weeklyCopayAcc: 0,
    weeklyInsurancePaidAcc: 0,
    weeklyCogsAcc: 0,
    weeklyMalpracticeAcc: 0,
    wagesAccrued: 0,
    weeklyVisitsAcc: 0,
  };

  const kpis: BusinessKPIs = {
    weeklyRevenue: 0,
    weeklyExpenses: 0,
    weeklyProfit: 0,
    marketShare: 0.12,
    customerSatisfaction: 70,
  };

  const derived: BusinessDerived = {
    footTraffic: 0,
    stockLevel: 1,
    pendingWages: 0,
    riskScore: 30,
  };

  return {
    id: params.id,
    ownerId: params.ownerId,
    type: "hospital_clinic",
    name: params.name,
    locationId: params.locationId,
    openedAtTick: params.tick,
    cash: dollars(35_000),
    state: state as unknown as Record<string, unknown>,
    kpis,
    derived,
  };
}

// ---------- Simulation ----------

function getState(biz: Business): HospitalClinicState {
  return structuredClone(biz.state) as unknown as HospitalClinicState;
}

function onHour(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const market = ctx.world.markets[biz.locationId];
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];

  if (!market || state.staff.length === 0) {
    return { business: updateDerivedOnly(biz, state), ledger: [], events: [] };
  }

  const hourMul = hourTrafficCurve(hourOf(ctx.tick));
  const coverage = clinicianRatio(state);
  const clinicianSkill = avgClinicianSkill(state);

  // Effective throughput — low coverage caps visits no matter how many people
  // show up.
  const rawTraffic = marketFootTraffic(market, ctx.macro, ctx.tick);
  const throughputCap = Math.round(8 * coverage); // max ~8 visits/hour at full coverage
  const demand =
    (rawTraffic / 30) *
    hourMul *
    (0.6 + state.marketingScore * 0.7) *
    (0.7 + state.careQuality * 0.5);
  const visits = Math.min(throughputCap, Math.max(0, Math.round(demand)));

  if (visits > 0) {
    const copayRevenue = visits * state.copayCents;
    const insuranceBillings = visits * state.insuranceBillingCents;
    const cogs = Math.round(visits * state.variableCostPerVisitCents);

    if (copayRevenue > 0) {
      ledgerEntries.push(
        ledger(
          `copay-${biz.id}-${ctx.tick}`,
          ctx.tick,
          copayRevenue,
          "revenue",
          "Copays",
          biz.id,
        ),
      );
    }

    // Insurance billings don't hit cash now; accrue to pending.
    state.pendingInsuranceCents += insuranceBillings;

    if (cogs > 0) {
      ledgerEntries.push(
        ledger(
          `cogs-${biz.id}-${ctx.tick}`,
          ctx.tick,
          -cogs,
          "cogs",
          "Supplies / meds",
          biz.id,
        ),
      );
    }

    state.weeklyCopayAcc += copayRevenue;
    state.weeklyCogsAcc += cogs;
    state.weeklyVisitsAcc += visits;

    // Malpractice roll per visit, extremely low but catastrophic.
    // Scales inversely with care quality and clinician skill.
    const perVisitRisk =
      0.00008 * (1 - state.careQuality) * (1 - clinicianSkill);
    // Aggregate by visits (poisson-ish approximation).
    for (let i = 0; i < visits; i++) {
      if (ctx.rng.chance(perVisitRisk)) {
        const settlement =
          dollars(40_000) +
          Math.round(ctx.rng.nextFloat(0, 1) * dollars(120_000));
        state.weeklyMalpracticeAcc += settlement;
        ledgerEntries.push(
          ledger(
            `mal-${biz.id}-${ctx.tick}-${i}`,
            ctx.tick,
            -settlement,
            "malpractice_settlement",
            "Malpractice settlement",
            biz.id,
          ),
        );
        events.push({
          kind: "business_event",
          title: `${biz.name} hit with malpractice claim`,
          detail: `Settlement booked at $${Math.round(settlement / 100).toLocaleString()}.`,
          impact: { reputationDelta: -2 },
        });
      }
    }

    const cashDelta =
      copayRevenue - cogs - state.weeklyMalpracticeAcc; // malpractice already deducted inline
    // NOTE: malpractice is already in ledger as a negative; don't double-deduct.
    // Use only copay + cogs for cash impact here:
    const cashOnly = copayRevenue - cogs;
    void cashDelta;
    biz.cash += 0; // no-op just for clarity
    state.wagesAccrued += state.staff.reduce((a, s) => a + s.hourlyWageCents, 0);

    const newCash = biz.cash + cashOnly - state.weeklyMalpracticeAcc * 0;
    // malpractice actually reduces cash on the tick it fires; do it now:
    let finalCash = newCash;
    if (state.weeklyMalpracticeAcc > 0) {
      finalCash -= 0; // placeholder — the settlement was booked to ledger already
      // realize settlements immediately in cash:
      finalCash -= state.weeklyMalpracticeAcc;
      state.weeklyMalpracticeAcc = 0; // consumed into cash
    }

    const updated: Business = {
      ...biz,
      cash: finalCash,
      state: state as unknown as Record<string, unknown>,
      derived: {
        ...biz.derived,
        footTraffic: visits,
        stockLevel: 1,
        pendingWages: state.wagesAccrued,
        riskScore: Math.max(
          0,
          Math.min(
            100,
            Math.round(30 + (1 - state.careQuality) * 40 + (1 - coverage) * 20),
          ),
        ),
      },
    };
    return { business: updated, ledger: ledgerEntries, events };
  }

  // No visits this hour. Still accrue wages.
  state.wagesAccrued += state.staff.reduce((a, s) => a + s.hourlyWageCents, 0);
  return {
    business: updateDerivedOnly(biz, state),
    ledger: [],
    events: [],
  };
}

function onDay(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  for (const s of state.staff) {
    s.morale = Math.max(0, Math.min(100, s.morale + ctx.rng.nextFloat(-2, 1.5)));
    s.skill = Math.min(100, s.skill + ctx.rng.nextFloat(0, 0.15));
  }
  // Care quality decays slowly without investment.
  state.careQuality = Math.max(0.3, state.careQuality - 0.001);
  return {
    business: { ...biz, state: state as unknown as Record<string, unknown> },
    ledger: [],
    events: [],
  };
}

function onWeek(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const ledgerEntries: LedgerEntry[] = [];
  let cash = biz.cash;

  // Insurance billings arrive this week for LAST week's visits. We bill them
  // now as insurance_billing revenue.
  if (state.pendingInsuranceCents > 0) {
    cash += state.pendingInsuranceCents;
    ledgerEntries.push(
      ledger(
        `ins-${biz.id}-${ctx.tick}`,
        ctx.tick,
        state.pendingInsuranceCents,
        "insurance_billing",
        "Insurance settlement (prior week)",
        biz.id,
      ),
    );
    state.weeklyInsurancePaidAcc = state.pendingInsuranceCents;
    state.pendingInsuranceCents = 0;
  }

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
      "Weekly rent",
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
        "Local / referral marketing",
        biz.id,
      ),
    );
    state.marketingScore = Math.min(
      1,
      state.marketingScore * 0.6 +
        Math.min(1, state.marketingWeekly / dollars(1_200)) * 0.4,
    );
  } else {
    state.marketingScore *= 0.6;
  }

  const weeklyRevenue = state.weeklyCopayAcc + state.weeklyInsurancePaidAcc;
  const weeklyExpenses =
    state.weeklyCogsAcc + state.wagesAccrued + weeklyRent + state.marketingWeekly;
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

  // CSAT target nudge.
  const target =
    50 +
    state.careQuality * 30 +
    state.marketingScore * 10 -
    (1 - clinicianRatio(state)) * 20;
  const next =
    biz.kpis.customerSatisfaction +
    (Math.max(0, Math.min(95, target)) - biz.kpis.customerSatisfaction) * 0.18;

  // Reset weekly.
  state.weeklyCopayAcc = 0;
  state.weeklyInsurancePaidAcc = 0;
  state.weeklyCogsAcc = 0;
  state.weeklyMalpracticeAcc = 0;
  state.wagesAccrued = 0;
  state.weeklyVisitsAcc = 0;

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
      derived: { ...biz.derived, pendingWages: 0 },
    },
    ledger: ledgerEntries,
    events: [],
  };
}

function updateDerivedOnly(biz: Business, state: HospitalClinicState): Business {
  return {
    ...biz,
    state: state as unknown as Record<string, unknown>,
    derived: { ...biz.derived, pendingWages: state.wagesAccrued },
  };
}

// ---------- Module ----------

export const hospitalClinicModule: BusinessTypeModule = {
  id: "hospital_clinic",
  ui,
  startup,
  create: createBusiness,
  onHour,
  onDay,
  onWeek,
};
