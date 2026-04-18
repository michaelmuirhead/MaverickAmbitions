/**
 * Nightclub — door cover + VIP bottles + weekend peak + noise risk.
 *
 * Distinctive mechanics vs bar/restaurant:
 *   - Revenue = cover charge (door) + bar (drinks) + VIP (table service
 *     bottles). VIP is a high-margin, low-throughput channel.
 *   - Operating hours are inverted: CLOSED during business hours,
 *     revenue only between 22:00 and 04:00, peaking on Fri/Sat.
 *   - Weekday nights lose money. The club has to earn enough on 2-3
 *     nights/week to cover a full week of rent + wages.
 *   - Every operating hour rolls a noise-complaint risk. Hit the
 *     complaint threshold and the city can suspend your license
 *     (a week of zero revenue).
 *   - Demand gates on reputation: a buzzy club can pack the floor at
 *     2× cover, a dead one can't give tickets away.
 *   - Liquor tax pulses bite nightclubs hardest (highest alcohol %
 *     of revenue).
 *
 * Strategic shape:
 *   $220K startup, unlocks at $180K NW — the first "high-variance"
 *   venue. Best cash-on-cash returns in the game if you run it well;
 *   worst if your CSAT dips (empty weekend = crushing fixed costs).
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

import { dayOfWeek, tickToDate } from "@/lib/date";
import { dollars } from "@/lib/money";

import { ECONOMY } from "../economy/constants";
import { corporateTax, ledger } from "../economy/finance";
import { getPulseBundle } from "../macro/events";
import { competitiveDensity, marketFootTraffic } from "../economy/market";
import { hospitalityHalo } from "../economy/reputation";
import {
  effectiveMarketingScore,
  hourlyWageMultiplier,
  hoursCsatBonus,
  isBusinessOpenNow,
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

function hourOf(tick: Tick): number {
  return getHours(tickToDate(tick));
}

// Hours the club operates (inclusive start, exclusive end — wraps midnight).
const CLUB_OPEN_HOUR = 22;
const CLUB_CLOSE_HOUR = 4;

function isOperatingHour(tick: Tick): boolean {
  const h = hourOf(tick);
  return h >= CLUB_OPEN_HOUR || h < CLUB_CLOSE_HOUR;
}

function isPeakNight(tick: Tick): boolean {
  // Thu/Fri/Sat nights are peak — 4=Thu, 5=Fri, 6=Sat.
  const d = dayOfWeek(tick);
  return d === 4 || d === 5 || d === 6;
}

// ---------- State ----------

export type ClubTheme = "edm" | "hiphop" | "mixed" | "latin";

export interface ClubStaff {
  id: Id;
  name: string;
  role: "bouncer" | "bartender" | "dj" | "waitress";
  hourlyWageCents: Cents;
  skill: number;
  morale: number;
}

export interface NightclubState {
  theme: ClubTheme;
  /** Door cover price in cents. */
  coverChargeCents: Cents;
  /** 0..1 perceived venue quality (sound, lights, celebrity DJs, etc.). */
  venueTier: number;
  /** 0..1 last-measured capacity utilization. */
  capacityFill: number;
  /** Total capacity. A bigger venue scales every channel linearly up to cap. */
  capacity: number;
  /** VIP tables. Small number, high revenue per table-night. */
  vipTables: number;
  /** Average bottle-service price per VIP table. */
  vipTablePrice: Cents;
  /** 0..1 how sound-insulated the venue is (reduces noise risk). */
  soundproofing: number;
  /** Noise complaints logged this week. */
  noiseComplaintsThisWeek: number;
  /** If > 0, the club is license-suspended and cannot operate. */
  licenseSuspendedUntilTick: Tick;

  rentMonthly: Cents;
  staff: ClubStaff[];

  weeklyCoverAcc: Cents;
  weeklyBarAcc: Cents;
  weeklyVipAcc: Cents;
  weeklyCogsAcc: Cents;
  wagesAccrued: Cents;
  weeklyCoversAcc: number;
}

// ---------- UI / startup ----------

const ui: BusinessUiDescriptor = {
  label: "Nightclub",
  icon: "🪩",
  kpiLabels: [
    "Weekly Profit",
    "Cover Charge",
    "VIP Utilization",
    "Noise Complaints",
  ],
  sections: ["door", "staff", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(220_000),
  minimumCreditScore: 660,
  unlocksAt: { netWorthCents: dollars(180_000) },
};

// ---------- Factory ----------

function createBusiness(params: {
  id: Id;
  ownerId: Id;
  name: string;
  locationId: Id;
  tick: Tick;
  seed: string;
}): Business {
  const state: NightclubState = {
    theme: "mixed",
    coverChargeCents: dollars(15),
    venueTier: 0.6,
    capacityFill: 0,
    capacity: 200,
    vipTables: 6,
    vipTablePrice: dollars(500),
    soundproofing: 0.5,
    noiseComplaintsThisWeek: 0,
    licenseSuspendedUntilTick: 0,
    rentMonthly: Math.round(ECONOMY.BASE_RENT_MONTHLY_CENTS * 3), // warehouse space
    staff: [
      { id: `${params.id}-bouncer-1`,    name: "Bouncer Alpha",    role: "bouncer",    hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.3), skill: 60, morale: 72 },
      { id: `${params.id}-bouncer-2`,    name: "Bouncer Beta",     role: "bouncer",    hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.3), skill: 55, morale: 70 },
      { id: `${params.id}-bartender-1`,  name: "Bartender Alpha",  role: "bartender",  hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.15), skill: 55, morale: 70 },
      { id: `${params.id}-bartender-2`,  name: "Bartender Beta",   role: "bartender",  hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.15), skill: 50, morale: 68 },
      { id: `${params.id}-dj`,           name: "Resident DJ",      role: "dj",         hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.8), skill: 60, morale: 72 },
      { id: `${params.id}-waitress-1`,   name: "VIP Host Alpha",   role: "waitress",   hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.1), skill: 55, morale: 70 },
    ],

    weeklyCoverAcc: 0,
    weeklyBarAcc: 0,
    weeklyVipAcc: 0,
    weeklyCogsAcc: 0,
    wagesAccrued: 0,
    weeklyCoversAcc: 0,
  };

  const kpis: BusinessKPIs = {
    weeklyRevenue: 0,
    weeklyExpenses: 0,
    weeklyProfit: 0,
    marketShare: 0.15,
    customerSatisfaction: 68,
  };

  const derived: BusinessDerived = {
    footTraffic: 0,
    stockLevel: 1,
    pendingWages: 0,
    riskScore: 25,
  };

  return {
    id: params.id,
    ownerId: params.ownerId,
    type: "nightclub",
    name: params.name,
    locationId: params.locationId,
    openedAtTick: params.tick,
    cash: dollars(18_000),
    state: state as unknown as Record<string, unknown>,
    kpis,
    derived,
  };
}

// ---------- Simulation ----------

function getState(biz: Business): NightclubState {
  return structuredClone(biz.state) as unknown as NightclubState;
}

function avgService(state: NightclubState): number {
  if (state.staff.length === 0) return 0;
  return (
    state.staff.reduce((a, s) => a + (s.skill * s.morale) / 10000, 0) /
    state.staff.length
  );
}

function competitorClubs(
  world: BusinessTickContext["world"],
  biz: Business,
): number {
  const market = world.markets[biz.locationId];
  if (!market) return 0;
  let n = 0;
  for (const id of market.businessIds) {
    if (id === biz.id) continue;
    const b = world.businesses[id];
    if (b && (b.type === "nightclub" || b.type === "bar")) n++;
  }
  return n;
}

function onHour(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const market = ctx.world.markets[biz.locationId];
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];

  // License suspension — no ops.
  if (ctx.tick < state.licenseSuspendedUntilTick) {
    return { business: updateDerivedOnly(biz, state), ledger: [], events: [] };
  }

  // v0.10: base operating hours (bars-at-night) intersect with the
  // player's schedule so a "closed Tuesdays" override works.
  if (
    !market ||
    !isOperatingHour(ctx.tick) ||
    !isBusinessOpenNow(biz, ctx.tick) ||
    state.staff.length === 0
  ) {
    return { business: updateDerivedOnly(biz, state), ledger: [], events: [] };
  }

  const pulse = getPulseBundle(ctx.world.activeEvents ?? []);
  // Bar-category pulse for liquor trend + liquor tax.
  const liquorTaxMul = pulse.liquorLicenseFeeMultiplier ?? 1;
  const trafficMul = pulse.trafficMultiplierByType.bar ?? 1;

  const peak = isPeakNight(ctx.tick);
  const service = avgService(state);
  const halo = hospitalityHalo(ctx.world, biz.ownerId, biz.locationId);

  // Crowd demand as a fraction of capacity.
  // Friday/Saturday at 00:00 is the max; weekday 22:00 is a graveyard.
  const hour = hourOf(ctx.tick);
  const peakHourCurve =
    hour === 0 || hour === 1
      ? 1.0
      : hour === 23 || hour === 2
        ? 0.85
        : hour === 22 || hour === 3
          ? 0.55
          : 0.25;

  const density = competitiveDensity(competitorClubs(ctx.world, biz));
  const rawMarketDemand =
    marketFootTraffic(market, ctx.macro, 12 + (ctx.tick % 24)) * 0.6; // abuse daytime traffic metric as population proxy
  const marketingScore = effectiveMarketingScore(leversOf(biz), market);
  const demandMul =
    (0.5 + marketingScore) *
    (0.6 + state.venueTier * 0.5) *
    (0.8 + service * 0.4) *
    (1 + halo) *
    peakHourCurve *
    (peak ? 1.6 : 0.45) *
    trafficMul /
    density;

  const drawnCrowd = Math.min(
    state.capacity,
    Math.round(rawMarketDemand * demandMul * 0.45),
  );
  state.capacityFill = drawnCrowd / Math.max(1, state.capacity);

  // Door revenue = cover × crowd. Weekday crowds sometimes get in free;
  // model this by halving cover collection outside peak.
  const coverPerHead = peak ? state.coverChargeCents : Math.round(state.coverChargeCents * 0.4);
  const coverRevenue = coverPerHead * drawnCrowd;

  // Bar revenue: average ticket × fraction that buy per hour. Bottle COGS
  // is ~25% — liquor tax pulse bumps it.
  const drinksPerHead = 0.8 + (peak ? 0.4 : 0);
  const avgDrinkPrice = dollars(14);
  const barRevenue = Math.round(drinksPerHead * drawnCrowd * avgDrinkPrice);
  const barCogs = Math.round(barRevenue * 0.25 * pulse.cogsMultiplier * liquorTaxMul);

  // VIP revenue: tables booked scales with demand fill and peak.
  const vipFillBase = peak ? 0.65 : 0.2;
  const vipFill = Math.min(
    1,
    vipFillBase * (0.6 + state.venueTier) * (0.6 + marketingScore) * demandMul,
  );
  const bookedTables = Math.round(state.vipTables * vipFill);
  const vipRevenue = bookedTables * state.vipTablePrice;
  const vipCogs = Math.round(vipRevenue * 0.22 * pulse.cogsMultiplier * liquorTaxMul);

  const revenue = coverRevenue + barRevenue + vipRevenue;
  const cogs = barCogs + vipCogs;

  if (coverRevenue > 0) {
    ledgerEntries.push(
      ledger(
        `cover-${biz.id}-${ctx.tick}`,
        ctx.tick,
        coverRevenue,
        "cover_charge",
        "Door cover",
        biz.id,
      ),
    );
  }
  if (barRevenue > 0) {
    ledgerEntries.push(
      ledger(
        `bar-${biz.id}-${ctx.tick}`,
        ctx.tick,
        barRevenue,
        "revenue",
        "Bar sales",
        biz.id,
      ),
    );
  }
  if (vipRevenue > 0) {
    ledgerEntries.push(
      ledger(
        `vip-${biz.id}-${ctx.tick}`,
        ctx.tick,
        vipRevenue,
        "revenue",
        "VIP bottle service",
        biz.id,
      ),
    );
  }
  if (cogs > 0) {
    ledgerEntries.push(
      ledger(
        `cogs-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -cogs,
        "cogs",
        "Bar COGS",
        biz.id,
      ),
    );
  }

  // Noise complaint risk — scales with crowd, time of night, inverse soundproofing.
  const complaintRisk =
    Math.max(0, (drawnCrowd / Math.max(1, state.capacity) - 0.5)) *
    (1 - state.soundproofing) *
    (hour >= 1 && hour <= 3 ? 1.5 : 1.0) *
    0.08;
  if (ctx.rng.chance(complaintRisk)) {
    state.noiseComplaintsThisWeek += 1;
    events.push({
      kind: "business_event",
      title: `Noise complaint at ${biz.name}`,
      detail:
        state.noiseComplaintsThisWeek >= 3
          ? "Third complaint this week — another and the city could suspend."
          : "Neighbors filed a noise complaint.",
    });
    if (state.noiseComplaintsThisWeek >= 4) {
      // Suspend for a week.
      state.licenseSuspendedUntilTick = ctx.tick + 24 * 7;
      events.push({
        kind: "business_event",
        title: `${biz.name} license suspended`,
        detail: "Too many noise complaints. Doors closed for 7 days.",
        impact: { reputationDelta: -2 },
      });
    }
  }

  // Wages accrue. Graveyard-hour premium — most nightclub hours fall in
  // the 22:00-06:00 window, so this is the norm not the exception.
  const wageMul = hourlyWageMultiplier(ctx.tick);
  const wagesThisHour = Math.round(
    state.staff.reduce((a, s) => a + s.hourlyWageCents, 0) * wageMul,
  );
  state.wagesAccrued += wagesThisHour;

  state.weeklyCoverAcc += coverRevenue;
  state.weeklyBarAcc += barRevenue;
  state.weeklyVipAcc += vipRevenue;
  state.weeklyCogsAcc += cogs;
  state.weeklyCoversAcc += drawnCrowd;

  const newCash = biz.cash + revenue - cogs;

  const updated: Business = {
    ...biz,
    cash: newCash,
    state: state as unknown as Record<string, unknown>,
    derived: {
      ...biz.derived,
      footTraffic: drawnCrowd,
      stockLevel: 1 - state.capacityFill,
      pendingWages: state.wagesAccrued,
      riskScore: Math.max(
        0,
        Math.min(
          100,
          25 + state.noiseComplaintsThisWeek * 10 + ctx.rng.nextFloat(-5, 5),
        ),
      ),
    },
  };

  return { business: updated, ledger: ledgerEntries, events };
}

function onDay(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  // Staff drift.
  for (const s of state.staff) {
    s.morale = Math.max(0, Math.min(100, s.morale + ctx.rng.nextFloat(-3, 2.5)));
    s.skill = Math.min(100, s.skill + ctx.rng.nextFloat(0, 0.2));
  }
  // Venue tier decays a hair per day unless refreshed (ambience capex, later UI).
  state.venueTier = Math.max(0.2, state.venueTier - 0.0015);

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

  // v0.10: channelized marketing — promoter/social blend is expressed as
  // sliders on the 6-channel panel; score decay + lift live in tickLevers().
  const weeklyMarketing = totalWeeklyMarketing(leversOf(biz));
  if (weeklyMarketing > 0) {
    cash -= weeklyMarketing;
    ledgerEntries.push(
      ledger(
        `mkt-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -weeklyMarketing,
        "marketing",
        "Promoters / socials",
        biz.id,
      ),
    );
  }

  // Liquor license fee — pulsed by macro event.
  const pulse = getPulseBundle(ctx.world.activeEvents ?? []);
  const licenseWeekly = Math.round(
    dollars(250) * (pulse.liquorLicenseFeeMultiplier ?? 1),
  );
  cash -= licenseWeekly;
  ledgerEntries.push(
    ledger(
      `liq-${biz.id}-${ctx.tick}`,
      ctx.tick,
      -licenseWeekly,
      "license_fee",
      "Liquor license (weekly)",
      biz.id,
    ),
  );

  const weeklyRevenue =
    state.weeklyCoverAcc + state.weeklyBarAcc + state.weeklyVipAcc;
  const weeklyExpenses =
    state.weeklyCogsAcc +
    state.wagesAccrued +
    weeklyRent +
    weeklyMarketing +
    licenseWeekly;
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

  // CSAT nudges: VIP fill and venue tier move it up; complaints move it down.
  const complaintDrag = state.noiseComplaintsThisWeek * 3;
  const csatMarketingScore = effectiveMarketingScore(
    leversOf(biz),
    ctx.world.markets[biz.locationId],
  );
  // v0.10: 24/7 / 140+ hr/wk schedule bonus (e.g. 6-day late-night run).
  const hoursBonus = hoursCsatBonus(leversOf(biz).hours);
  const target =
    55 +
    state.venueTier * 25 +
    csatMarketingScore * 10 +
    (state.weeklyVipAcc > dollars(5000) ? 5 : 0) +
    hoursBonus -
    complaintDrag;
  const next =
    biz.kpis.customerSatisfaction +
    (Math.max(0, Math.min(90, target)) - biz.kpis.customerSatisfaction) * 0.2;

  // Reset weekly.
  state.weeklyCoverAcc = 0;
  state.weeklyBarAcc = 0;
  state.weeklyVipAcc = 0;
  state.weeklyCogsAcc = 0;
  state.wagesAccrued = 0;
  state.weeklyCoversAcc = 0;
  state.noiseComplaintsThisWeek = 0;

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
    events:
      weeklyProfit < -dollars(10_000)
        ? [
            {
              kind: "business_event",
              title: `${biz.name} bled badly this week`,
              detail:
                "Cover and VIP were soft, fixed costs crushed margin. Promo harder or cut capacity.",
            },
          ]
        : [],
  };
}

function updateDerivedOnly(biz: Business, state: NightclubState): Business {
  return {
    ...biz,
    derived: { ...biz.derived, pendingWages: state.wagesAccrued },
  };
}

// ---------- Module export ----------

export const nightclubModule: BusinessTypeModule = {
  id: "nightclub",
  ui,
  startup,
  create: createBusiness,
  onHour,
  onDay,
  onWeek,
};
