/**
 * Restaurant business module — full-service sit-down.
 *
 * Where the cafe sells items and the bar sells pours, the restaurant's
 * unit is the COVER: one seated diner. The sim derives covers per hour
 * from the menu program (which sets table-turn time) and the seat count,
 * then resolves revenue via a weighted-mix check average.
 *
 * Distinctive knobs:
 *   1. Reservations (0..1 slider) — fills the seat chart ahead of time.
 *      Higher = steadier demand but softer upside on blockbuster nights;
 *      lower = more walk-in risk but higher peaks.
 *   2. Menu program — diner / bistro / chef-driven. Drives cost, price
 *      ceiling, CSAT ceiling, and throughput.
 *   3. Chef salary + line cook wages — chef tenure quietly lifts CSAT
 *      ceiling; turnover hurts.
 *
 * Tips still flow (see hospitality.ts), peak curve is lunch+dinner, and
 * liquor license is the restaurant rate (carve-out for beer+wine service).
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
import { getPulseBundle } from "../macro/events";
import {
  competitiveDensity,
  marketFootTraffic,
  priceAttractiveness,
} from "../economy/market";
import { hospitalityHalo } from "../economy/reputation";
import { RESTAURANT_MENU, type DishId } from "@/data/restaurantMenu";
import {
  effectiveMarketingScore,
  leversOf,
  totalWeeklyMarketing,
} from "./leverState";

import {
  MENU_PROGRAM,
  type MenuProgram,
  hospitalityIsOpen,
  liquorLicenseMonthly,
  restaurantPeakMultiplier,
  tipPool,
} from "./hospitality";

import type {
  BusinessStartupSpec,
  BusinessTickContext,
  BusinessTickResult,
  BusinessTypeModule,
  BusinessUiDescriptor,
} from "./types";

// ---------- Type-specific state ----------

export interface RestaurantState {
  menu: Record<DishId, RestaurantMenuItem>;
  cooks: LineCook[];
  servers: Server[];
  chef: Chef;
  program: MenuProgram;

  /** Number of bookable covers per seating. */
  seatCount: number;
  /** 0..1 — portion of peak seats reserved in advance. */
  reservationDensity: number;
  /** 0..1 — location quality at open. */
  locationQuality: number;
  /** 0..1 — ambience, decays over time. */
  ambience: number;
  /** Tick when ambience last refreshed. */
  lastAmbienceRefreshTick: Tick;
  rentMonthly: Cents;

  /** Weekly accumulators. */
  weeklyRevenueAcc: Cents;
  weeklyCogsAcc: Cents;
  weeklyCoversAcc: number;
  wagesAccrued: Cents;
  tipsAccrued: Cents;
  noShowsThisWeek: number;

  /** Rolling 4-week CSAT history. */
  csatHistory: number[];

  /** Monthly license tick-counter. */
  ticksSinceLicenseCharge: number;

  /** Ticks since last menu refresh — long-stale menus cap CSAT. */
  ticksSinceMenuRefresh: number;
}

export interface RestaurantMenuItem {
  id: DishId;
  cost: Cents;
  price: Cents;
  referencePrice: Cents;
  popularity: number;
  lineSeconds: number;
}

export interface LineCook {
  id: Id;
  name: string;
  hourlyWageCents: Cents;
  craft: number; // 0..100
  morale: number;
}

export interface Server {
  id: Id;
  name: string;
  hourlyWageCents: Cents; // tipped
  craft: number;
  morale: number;
}

export interface Chef {
  id: Id;
  name: string;
  /** Salary is charged weekly, flat. */
  weeklySalaryCents: Cents;
  /** Tenure in weeks — reduces CSAT volatility, lifts ceiling. */
  tenureWeeks: number;
  craft: number;
  morale: number;
}

// ---------- UI / startup ----------

const ui: BusinessUiDescriptor = {
  label: "Restaurant",
  icon: "🍽️",
  kpiLabels: [
    "Customer Satisfaction",
    "Weekly Profit",
    "Daily Covers",
    "Reservation Fill",
  ],
  sections: ["menu", "staff", "pricing", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(200_000),
  minimumCreditScore: 700,
  requiredSkills: { management: 30 },
  unlocksAt: { netWorthCents: dollars(150_000) },
};

// ---------- Factory ----------

function buildInitialMenu(
  program: typeof MENU_PROGRAM[MenuProgram],
): Record<DishId, RestaurantMenuItem> {
  const out: Record<DishId, RestaurantMenuItem> = {} as Record<DishId, RestaurantMenuItem>;
  for (const dish of RESTAURANT_MENU) {
    const cost = Math.round(dish.baseCost * program.costMultiplier);
    const price = Math.round(dish.basePrice * program.priceMultiplier);
    out[dish.id] = {
      id: dish.id,
      cost,
      price,
      referencePrice: price,
      popularity: dish.popularity,
      lineSeconds: dish.lineSeconds,
    };
  }
  return out;
}

function createBusiness(params: {
  id: Id;
  ownerId: Id;
  name: string;
  locationId: Id;
  tick: Tick;
  seed: string;
}): Business {
  const programKey: MenuProgram = "bistro";
  const program = MENU_PROGRAM[programKey];

  const state: RestaurantState = {
    menu: buildInitialMenu(program),
    cooks: [
      {
        id: `${params.id}-cook-1`,
        name: "Line Cook Alpha",
        hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.1),
        craft: 55,
        morale: 70,
      },
      {
        id: `${params.id}-cook-2`,
        name: "Line Cook Beta",
        hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.0),
        craft: 45,
        morale: 68,
      },
    ],
    servers: [
      {
        id: `${params.id}-srv-1`,
        name: "Server Alpha",
        hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 0.55),
        craft: 60,
        morale: 72,
      },
      {
        id: `${params.id}-srv-2`,
        name: "Server Beta",
        hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 0.55),
        craft: 50,
        morale: 70,
      },
    ],
    chef: {
      id: `${params.id}-chef`,
      name: "Chef",
      weeklySalaryCents: dollars(1_600),
      tenureWeeks: 0,
      craft: 75,
      morale: 75,
    },
    program: programKey,

    seatCount: 48,
    reservationDensity: 0.35,
    locationQuality: 0.6,
    ambience: 0.75,
    lastAmbienceRefreshTick: params.tick,
    rentMonthly: Math.round(ECONOMY.BASE_RENT_MONTHLY_CENTS * 1.9),

    weeklyRevenueAcc: 0,
    weeklyCogsAcc: 0,
    weeklyCoversAcc: 0,
    wagesAccrued: 0,
    tipsAccrued: 0,
    noShowsThisWeek: 0,

    csatHistory: [70],
    ticksSinceLicenseCharge: 0,
    ticksSinceMenuRefresh: 0,
  };

  const kpis: BusinessKPIs = {
    weeklyRevenue: 0,
    weeklyExpenses: 0,
    weeklyProfit: 0,
    marketShare: 0.09,
    customerSatisfaction: 72,
  };

  const derived: BusinessDerived = {
    footTraffic: 0,
    stockLevel: 1,
    pendingWages: 0,
    riskScore: 10,
  };

  return {
    id: params.id,
    ownerId: params.ownerId,
    type: "restaurant",
    name: params.name,
    locationId: params.locationId,
    openedAtTick: params.tick,
    cash: dollars(20_000),
    state: state as unknown as Record<string, unknown>,
    kpis,
    derived,
  };
}

// ---------- Simulation ----------

function getState(biz: Business): RestaurantState {
  // Deep-clone so in-place mutations inside onHour/onDay/onWeek don't touch
  // the frozen input state. The cloned tree is packaged back into the
  // returned Business via `state: state as ...`, keeping the module pure
  // from stepTick's point of view.
  return structuredClone(biz.state) as unknown as RestaurantState;
}

function avgServerService(state: RestaurantState): number {
  if (state.servers.length === 0) return 0;
  return (
    state.servers.reduce((acc, s) => acc + (s.craft * s.morale) / 10000, 0) /
    state.servers.length
  );
}

function avgKitchenCraft(state: RestaurantState): number {
  const cookAvg =
    state.cooks.length === 0
      ? 0
      : state.cooks.reduce((a, c) => a + c.craft, 0) / state.cooks.length;
  // Chef weights 0.4, line 0.6.
  return 0.4 * state.chef.craft + 0.6 * cookAvg;
}

function competitorRestaurantsInMarket(
  world: BusinessTickContext["world"],
  biz: Business,
): number {
  const market = world.markets[biz.locationId];
  if (!market) return 0;
  let n = 0;
  for (const id of market.businessIds) {
    if (id === biz.id) continue;
    const b = world.businesses[id];
    if (b && b.type === "restaurant") n++;
  }
  return n;
}

/**
 * Hourly: resolve the covers. Capacity = seats × turns-per-hour, where
 * turns-per-hour is 60 / menu-program turn minutes (capped by line
 * throughput). Reservation density fills a fraction of capacity at the
 * start of each peak; the rest is walk-ins, resolved via price and
 * service like cafes.
 */
function onHour(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const market = ctx.world.markets[biz.locationId];
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];

  if (
    !market ||
    !hospitalityIsOpen("restaurant", ctx.tick) ||
    state.cooks.length === 0 ||
    state.servers.length === 0
  ) {
    return {
      business: updateDerivedOnly(biz, state),
      ledger: [],
      events: [],
    };
  }

  const peak = restaurantPeakMultiplier(ctx.tick);
  const program = MENU_PROGRAM[state.program];

  // v0.5 macro-shock pulse: read once per hour. Traffic multiplier is
  // where viral_food_trend lives; cogs multiplier handles commodity_shortage.
  const pulse = getPulseBundle(ctx.world.activeEvents ?? []);
  const trafficMul = pulse.trafficMultiplierByType.restaurant ?? 1;

  const baseTraffic =
    marketFootTraffic(market, ctx.macro, ctx.tick) * peak * trafficMul;
  const density = competitiveDensity(competitorRestaurantsInMarket(ctx.world, biz));
  const service = avgServerService(state);
  const kitchen = avgKitchenCraft(state) / 100; // 0..1

  const ownHalo = hospitalityHalo(ctx.world, biz.ownerId, biz.locationId);
  const csatBoost = Math.max(0.7, biz.kpis.customerSatisfaction / 70);
  const ambienceBoost = 0.7 + state.ambience * 0.5;

  // Turns per hour derived from program + kitchen craft.
  const turnMinutes = Math.max(
    25,
    program.turnMinutes * (1.1 - kitchen * 0.3),
  );
  const turnsPerHour = 60 / turnMinutes;
  const capacityThisHour = Math.round(state.seatCount * turnsPerHour);

  // Reserved covers show up deterministically at peak hours.
  const reservedCovers =
    peak >= 1.0
      ? Math.round(capacityThisHour * state.reservationDensity)
      : 0;
  // Roll no-shows on reservations — gets worse with popularity swings.
  const noShowRate = 0.08 + ctx.rng.nextFloat(0, 0.06);
  const actualReserved = Math.max(
    0,
    reservedCovers - Math.round(reservedCovers * noShowRate),
  );
  state.noShowsThisWeek += reservedCovers - actualReserved;

  // Walk-in covers resolved via traffic × visit rate × price mod.
  const remainingCap = Math.max(0, capacityThisHour - actualReserved);
  const marketingScore = effectiveMarketingScore(leversOf(biz), market);
  const visitRate =
    ECONOMY.BASE_VISIT_RATE *
    1.2 *
    (0.5 + marketingScore) *
    (0.6 + state.locationQuality) *
    csatBoost *
    (1 + ownHalo) *
    ambienceBoost /
    density;

  // Use average menu price ratio as a single price signal; this is a
  // coarser model than the cafe but fits the check-average pattern.
  const avgPriceRatio =
    Object.values(state.menu).reduce(
      (a, m) => a + m.price / Math.max(1, m.referencePrice),
      0,
    ) / Math.max(1, Object.keys(state.menu).length);
  const priceMod = priceAttractiveness(avgPriceRatio);

  const expectedWalkIns = Math.max(
    0,
    Math.round(
      baseTraffic * visitRate * (0.5 + service) * priceMod +
        ctx.rng.nextFloat(-2, 2),
    ),
  );
  const walkInCovers = Math.min(remainingCap, expectedWalkIns);
  const totalCovers = actualReserved + walkInCovers;

  // Check average — mix-weighted over the menu.
  const weightTotal = Object.values(state.menu).reduce(
    (a, m) => a + m.popularity,
    0,
  );
  let checkSum = 0;
  let cogsSum = 0;
  for (const item of Object.values(state.menu)) {
    const share = item.popularity / Math.max(0.01, weightTotal);
    checkSum += item.price * share;
    cogsSum += item.cost * share;
  }
  // A cover buys ~1.6 items worth of check (a main + partial apps/drinks).
  const perCoverRevenue = Math.round(checkSum * 1.6);
  const perCoverCogs = Math.round(cogsSum * 1.6 * pulse.cogsMultiplier);

  const hourRevenue = perCoverRevenue * totalCovers;
  const hourCogs = perCoverCogs * totalCovers;

  if (hourRevenue > 0) {
    ledgerEntries.push(
      ledger(
        `rev-${biz.id}-${ctx.tick}`,
        ctx.tick,
        hourRevenue,
        "revenue",
        "Hourly covers",
        biz.id,
      ),
    );
    ledgerEntries.push(
      ledger(
        `cogs-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -hourCogs,
        "cogs",
        "Hourly COGS",
        biz.id,
      ),
    );
  }

  // Tips (accrued; paid weekly). Program boost compounds with base rate.
  const tipsThisHour = tipPool(hourRevenue, 0.18 + program.tipBoost);
  state.tipsAccrued += tipsThisHour;

  // Wages accrue — cooks + servers (hourly; chef is salaried, paid weekly).
  const cookWages = state.cooks.reduce((a, c) => a + c.hourlyWageCents, 0);
  const serverWages = state.servers.reduce((a, s) => a + s.hourlyWageCents, 0);
  state.wagesAccrued += cookWages + serverWages;

  state.weeklyRevenueAcc += hourRevenue;
  state.weeklyCogsAcc += hourCogs;
  state.weeklyCoversAcc += totalCovers;

  const newCash = biz.cash + hourRevenue - hourCogs;

  const updated: Business = {
    ...biz,
    cash: newCash,
    state: state as unknown as Record<string, unknown>,
    derived: {
      ...biz.derived,
      footTraffic: baseTraffic,
      stockLevel: 1,
      pendingWages: state.wagesAccrued,
      riskScore: Math.max(
        0,
        Math.min(
          100,
          20 - kitchen * 15 - service * 10 + state.noShowsThisWeek * 0.3,
        ),
      ),
    },
  };

  return { business: updated, ledger: ledgerEntries, events };
}

/**
 * Daily: morale walk, chef tenure bump, ambience decay, flywheel.
 */
function onDay(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);

  // Morale walk.
  for (const s of state.servers) {
    s.morale = Math.max(0, Math.min(100, s.morale + ctx.rng.nextFloat(-3, 2)));
    s.craft = Math.min(100, s.craft + ctx.rng.nextFloat(0, 0.2));
  }
  for (const c of state.cooks) {
    c.morale = Math.max(0, Math.min(100, c.morale + ctx.rng.nextFloat(-3, 2)));
    c.craft = Math.min(100, c.craft + ctx.rng.nextFloat(0, 0.2));
  }
  state.chef.morale = Math.max(
    0,
    Math.min(100, state.chef.morale + ctx.rng.nextFloat(-2, 1.5)),
  );

  // Ambience decay.
  state.ambience = Math.max(0.45, state.ambience - 0.0015);

  // Flywheel.
  const program = MENU_PROGRAM[state.program];
  const service = avgServerService(state);
  const kitchen = avgKitchenCraft(state) / 100;
  const avgPriceRatio =
    Object.values(state.menu).reduce(
      (a, m) => a + m.price / Math.max(1, m.referencePrice),
      0,
    ) / Math.max(1, Object.keys(state.menu).length);
  const priceFairness = priceAttractiveness(avgPriceRatio);

  // Tenure bonus: capped +4 at 26 weeks+.
  const tenureBump = Math.min(4, state.chef.tenureWeeks / 6.5);
  // Stale menu penalty: after 12 weeks without refresh, CSAT ceiling pulls down.
  const staleWeeks = state.ticksSinceMenuRefresh / 168;
  const stalePenalty = staleWeeks > 12 ? Math.min(8, staleWeeks - 12) : 0;

  const csatMarketingScore = effectiveMarketingScore(
    leversOf(biz),
    ctx.world.markets[biz.locationId],
  );
  const target =
    50 +
    service * 20 +
    kitchen * 30 +
    (state.ambience - 0.5) * 15 +
    (priceFairness - 1) * 10 +
    (csatMarketingScore - 0.3) * 4 +
    tenureBump -
    stalePenalty -
    state.noShowsThisWeek * 0.4;

  const ceiling = program.csatCeiling;
  const clampedTarget = Math.max(0, Math.min(ceiling, target));
  const prev = biz.kpis.customerSatisfaction;
  const next = prev + (clampedTarget - prev) * 0.13;

  const events: BusinessTickResult["events"] = [];
  if (prev < 85 && next >= 85) {
    events.push({
      kind: "milestone",
      title: `${biz.name} is booking out`,
      detail: "CSAT crossed 85 — the room is full every Saturday.",
      impact: { reputationDelta: 1 },
    });
  }

  state.ticksSinceMenuRefresh += 24;

  return {
    business: {
      ...biz,
      state: state as unknown as Record<string, unknown>,
      kpis: { ...biz.kpis, customerSatisfaction: next },
    },
    ledger: [],
    events,
  };
}

/**
 * Weekly: wages, tips payout, chef salary, rent, marketing, license,
 * CSAT history, tax.
 */
function onWeek(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const ledgerEntries: LedgerEntry[] = [];
  let cash = biz.cash;

  // Hourly-wage payroll (cooks + servers).
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

  // Chef salary.
  cash -= state.chef.weeklySalaryCents;
  ledgerEntries.push(
    ledger(
      `chef-${biz.id}-${ctx.tick}`,
      ctx.tick,
      -state.chef.weeklySalaryCents,
      "wages",
      "Chef weekly salary",
      biz.id,
    ),
  );
  state.chef.tenureWeeks += 1;

  // Tips payout.
  if (state.tipsAccrued > 0) {
    cash -= state.tipsAccrued;
    ledgerEntries.push(
      ledger(
        `tips-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -state.tipsAccrued,
        "tips",
        "Weekly tips distribution",
        biz.id,
      ),
    );
    for (const s of state.servers) s.morale = Math.min(100, s.morale + 2);
  }

  // Rent.
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

  // v0.10: channelized marketing — sum across 6 sliders; per-channel
  // decay + lift happen each hour in tickLevers().
  const weeklyMarketing = totalWeeklyMarketing(leversOf(biz));
  if (weeklyMarketing > 0) {
    cash -= weeklyMarketing;
    ledgerEntries.push(
      ledger(
        `mkt-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -weeklyMarketing,
        "marketing",
        "Weekly marketing",
        biz.id,
      ),
    );
  }

  // License fee monthly.
  state.ticksSinceLicenseCharge += 1;
  if (state.ticksSinceLicenseCharge >= 4) {
    // liquor_tax_hike event multiplies the fee via pulse bundle.
    const weeklyPulse = getPulseBundle(ctx.world.activeEvents ?? []);
    const fee = Math.round(
      liquorLicenseMonthly("restaurant") *
        weeklyPulse.liquorLicenseFeeMultiplier,
    );
    cash -= fee;
    ledgerEntries.push(
      ledger(
        `lic-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -fee,
        "license_fee",
        "Beer & wine license",
        biz.id,
      ),
    );
    state.ticksSinceLicenseCharge = 0;
  }

  // Ambience weekly decay.
  state.ambience = Math.max(0.45, state.ambience - 0.01);

  const weeklyRevenue = state.weeklyRevenueAcc;
  const weeklyExpenses =
    state.weeklyCogsAcc +
    state.wagesAccrued +
    state.chef.weeklySalaryCents +
    state.tipsAccrued +
    weeklyRent +
    weeklyMarketing;
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

  const nextHistory = [
    ...state.csatHistory.slice(-3),
    biz.kpis.customerSatisfaction,
  ];
  state.csatHistory = nextHistory;

  state.weeklyRevenueAcc = 0;
  state.weeklyCogsAcc = 0;
  state.weeklyCoversAcc = 0;
  state.wagesAccrued = 0;
  state.tipsAccrued = 0;
  state.noShowsThisWeek = 0;

  const kpis: BusinessKPIs = {
    ...biz.kpis,
    weeklyRevenue,
    weeklyExpenses,
    weeklyProfit,
  };

  return {
    business: {
      ...biz,
      cash,
      state: state as unknown as Record<string, unknown>,
      kpis,
      derived: {
        ...biz.derived,
        pendingWages: 0,
      },
    },
    ledger: ledgerEntries,
    events:
      weeklyProfit < 0 && biz.kpis.customerSatisfaction < 60
        ? [
            {
              kind: "business_event",
              title: `${biz.name} is underwater`,
              detail:
                "Low CSAT plus negative weekly profit — refresh the menu, fix the front of house, or close before the chef walks.",
            },
          ]
        : [],
  };
}

function updateDerivedOnly(biz: Business, state: RestaurantState): Business {
  return {
    ...biz,
    derived: {
      ...biz.derived,
      pendingWages: state.wagesAccrued,
    },
  };
}

// ---------- Module export ----------

export const restaurantModule: BusinessTypeModule = {
  id: "restaurant",
  ui,
  startup,
  create: createBusiness,
  onHour,
  onDay,
  onWeek,
};
