/**
 * Food truck — mobile, weather-dependent street food.
 *
 * The distinctive twist vs cafe/restaurant:
 *   - NO rent. You lease street permits instead (flat weekly).
 *   - Much lower capex than a sit-down restaurant.
 *   - Revenue gates on WEATHER and WEEKDAY. A seeded weather roll each day
 *     drives traffic between 0.3× (storm) and 1.3× (perfect day). Weekday
 *     lunch rush dominates revenue.
 *   - Owner picks a "route" (which neighborhood-archetype to lean into).
 *     Office-heavy routes peak at lunch; entertainment routes peak at night.
 *   - Throughput is gated by the single window — one truck, one cook, one
 *     cashier — which caps growth and makes multi-truck empires meaningful
 *     (each truck is its own Business record).
 *
 * Strategic shape:
 *   Corner store / food truck / cafe all sit in the "entry" tier at
 *   <$100K startup. The food truck swaps "fixed overhead + inventory
 *   depth" for "mobile, capex-light, weather-dependent." Good cash
 *   engine, brittle to bad weather streaks.
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

import { dayOfWeek, isWeekend, tickToDate } from "@/lib/date";
import { dollars } from "@/lib/money";

import { ECONOMY } from "../economy/constants";
import { corporateTax, ledger } from "../economy/finance";
import { getPulseBundle } from "../macro/events";
import {
  competitiveDensity,
  marketFootTraffic,
  priceAttractiveness,
} from "../economy/market";
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

// date-fns getHours isn't in our `@/lib/date` re-export; pull directly.
function hourOf(tick: Tick): number {
  return getHours(tickToDate(tick));
}

// ---------- State ----------

export type FoodTruckRoute =
  | "office_lunch"
  | "entertainment_night"
  | "beach_weekend"
  | "festival_roaming";

export interface FoodTruckItem {
  id: string;
  name: string;
  cost: Cents;
  price: Cents;
  referencePrice: Cents;
  /** Portions prepped each morning. Cook can also batch-restock mid-day. */
  stock: number;
  dailyPar: number;
  prepSeconds: number;
}

export interface FoodTruckCrew {
  id: Id;
  name: string;
  role: "cook" | "runner";
  hourlyWageCents: Cents;
  skill: number; // 0..100
  morale: number;
}

export interface FoodTruckState {
  items: Record<string, FoodTruckItem>;
  crew: FoodTruckCrew[];
  route: FoodTruckRoute;
  /** Weekly street-permit fee (cents). Replaces rent. */
  permitWeekly: Cents;
  /** 0..1 truck condition — decays, refresh via capex. */
  truckCondition: number;
  /** Last weather roll (today). 0.3..1.3. */
  weatherToday: number;
  /** The date-int of the last weather roll, so we only roll once per day. */
  weatherRolledOnDayIndex: number;
  weeklyRevenueAcc: Cents;
  weeklyCogsAcc: Cents;
  weeklyCoversAcc: number;
  wagesAccrued: Cents;
  /** Truly bad-weather days bite morale. */
  stormDaysThisWeek: number;
}

// ---------- Routes ----------

interface RouteProfile {
  /** Peak-hour window for this route — inclusive start, exclusive end. */
  peakStart: number;
  peakEnd: number;
  /** Multiplier during peak hours. */
  peakMul: number;
  /** Multiplier outside of peak but still in business hours. */
  offPeakMul: number;
  /** Weekend bonus/penalty (office routes sag, beach/festival spike). */
  weekendMul: number;
  label: string;
}

const ROUTE: Record<FoodTruckRoute, RouteProfile> = {
  office_lunch:        { peakStart: 11, peakEnd: 14, peakMul: 2.2, offPeakMul: 0.55, weekendMul: 0.45, label: "Office Lunch" },
  entertainment_night: { peakStart: 19, peakEnd: 24, peakMul: 2.0, offPeakMul: 0.50, weekendMul: 1.35, label: "Entertainment Night" },
  beach_weekend:       { peakStart: 12, peakEnd: 19, peakMul: 1.7, offPeakMul: 0.70, weekendMul: 1.70, label: "Beach / Waterfront" },
  festival_roaming:    { peakStart: 16, peakEnd: 22, peakMul: 1.9, offPeakMul: 0.75, weekendMul: 1.45, label: "Festival Roaming" },
};

// ---------- UI / startup ----------

const ui: BusinessUiDescriptor = {
  label: "Food Truck",
  icon: "🚚",
  kpiLabels: [
    "Weekly Profit",
    "Daily Covers",
    "Truck Condition",
    "Weather",
  ],
  sections: ["route", "menu", "staff", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(45_000),
  minimumCreditScore: 600,
  unlocksAt: { netWorthCents: dollars(25_000) },
};

// ---------- Factory ----------

const DEFAULT_ITEMS: Array<Omit<FoodTruckItem, "stock">> = [
  { id: "taco",       name: "Street Taco",   cost: 90,  price: 400,  referencePrice: 400,  dailyPar: 120, prepSeconds: 45 },
  { id: "burrito",    name: "Burrito",       cost: 180, price: 900,  referencePrice: 900,  dailyPar: 60,  prepSeconds: 120 },
  { id: "fries",      name: "Loaded Fries",  cost: 70,  price: 550,  referencePrice: 550,  dailyPar: 80,  prepSeconds: 60 },
  { id: "drink",      name: "Canned Drink",  cost: 40,  price: 300,  referencePrice: 300,  dailyPar: 120, prepSeconds: 5 },
  { id: "special",    name: "Daily Special", cost: 250, price: 1100, referencePrice: 1100, dailyPar: 40,  prepSeconds: 150 },
];

function buildItems(): Record<string, FoodTruckItem> {
  const out: Record<string, FoodTruckItem> = {};
  for (const d of DEFAULT_ITEMS) {
    out[d.id] = { ...d, stock: d.dailyPar };
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
  const state: FoodTruckState = {
    items: buildItems(),
    crew: [
      {
        id: `${params.id}-cook`,
        name: "Cook Alpha",
        role: "cook",
        hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.2),
        skill: 55,
        morale: 70,
      },
      {
        id: `${params.id}-runner`,
        name: "Runner Alpha",
        role: "runner",
        hourlyWageCents: ECONOMY.BASE_HOURLY_WAGE_CENTS,
        skill: 40,
        morale: 68,
      },
    ],
    route: "office_lunch",
    permitWeekly: dollars(350), // much less than fixed rent
    truckCondition: 0.85,
    weatherToday: 1.0,
    weatherRolledOnDayIndex: -1,
    weeklyRevenueAcc: 0,
    weeklyCogsAcc: 0,
    weeklyCoversAcc: 0,
    wagesAccrued: 0,
    stormDaysThisWeek: 0,
  };

  const kpis: BusinessKPIs = {
    weeklyRevenue: 0,
    weeklyExpenses: 0,
    weeklyProfit: 0,
    marketShare: 0.05,
    customerSatisfaction: 70,
  };

  const derived: BusinessDerived = {
    footTraffic: 0,
    stockLevel: 1,
    pendingWages: 0,
    riskScore: 15,
  };

  return {
    id: params.id,
    ownerId: params.ownerId,
    type: "food_truck",
    name: params.name,
    locationId: params.locationId,
    openedAtTick: params.tick,
    cash: dollars(3_500), // street-vendor float
    state: state as unknown as Record<string, unknown>,
    kpis,
    derived,
  };
}

// ---------- Simulation ----------

function getState(biz: Business): FoodTruckState {
  return structuredClone(biz.state) as unknown as FoodTruckState;
}

function computeStockLevel(state: FoodTruckState): number {
  const values = Object.values(state.items);
  if (values.length === 0) return 0;
  let pct = 0;
  for (const s of values) pct += Math.min(1, s.stock / Math.max(1, s.dailyPar));
  return pct / values.length;
}

function avgCrewService(state: FoodTruckState): number {
  if (state.crew.length === 0) return 0;
  return (
    state.crew.reduce((acc, c) => acc + (c.skill * c.morale) / 10000, 0) /
    state.crew.length
  );
}

function inPeakWindow(route: FoodTruckRoute, hour: number): boolean {
  const r = ROUTE[route];
  return hour >= r.peakStart && hour < r.peakEnd;
}

/** Seeded weather draw once per in-game day. */
function weatherRoll(rng: BusinessTickContext["rng"]): number {
  // Long tail on the low side — the occasional storm can tank a day.
  const u = rng.next();
  if (u < 0.06) return 0.3; // storm
  if (u < 0.18) return 0.55; // rain
  if (u < 0.55) return 0.95; // overcast / average
  if (u < 0.88) return 1.1; // good day
  return 1.3; // picture-perfect
}

function onHour(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const market = ctx.world.markets[biz.locationId];
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];

  if (!market || !isBusinessOpenNow(biz, ctx.tick) || state.crew.length === 0) {
    return {
      business: updateDerivedOnly(biz, state),
      ledger: [],
      events: [],
    };
  }

  const hour = hourOf(ctx.tick);
  const route = ROUTE[state.route];
  const pulse = getPulseBundle(ctx.world.activeEvents ?? []);

  // Route + weekday modifiers.
  const peak = inPeakWindow(state.route, hour);
  const routeMul = peak ? route.peakMul : route.offPeakMul;
  const weekendMul = isWeekend(ctx.tick) ? route.weekendMul : 1.0;

  // Compose the truck's effective traffic.
  const baseTraffic = marketFootTraffic(market, ctx.macro, ctx.tick);
  const weather = state.weatherToday;
  const density = competitiveDensity(
    countSameTypeCompetitors(ctx.world, biz) / 2, // food trucks don't crowd each other as hard
  );

  const marketingScore = effectiveMarketingScore(leversOf(biz), market);
  const visitRate =
    ECONOMY.BASE_VISIT_RATE *
    1.8 * // street food has high intent
    (0.5 + marketingScore) *
    (0.6 + state.truckCondition * 0.4) *
    weather *
    routeMul *
    weekendMul /
    density;

  // Throughput cap: single window. A cook can prep ~40s avg per order.
  const service = avgCrewService(state);
  const hourSeconds = 3600;
  const cookEfficiency = 0.6 + service * 0.8;
  const avgPrepSec =
    Object.values(state.items).reduce((a, m) => a + m.prepSeconds, 0) /
    Math.max(1, Object.keys(state.items).length);
  const maxCoversPerHour = Math.round(
    hourSeconds / Math.max(5, avgPrepSec / cookEfficiency),
  );
  // One window is the ceiling — no parallelism.
  const throughputCap = maxCoversPerHour;

  let hourRevenue = 0;
  let hourCogs = 0;
  let covers = 0;

  const menu = Object.values(state.items);
  const itemCount = Math.max(1, menu.length);
  for (const id of Object.keys(state.items)) {
    if (covers >= throughputCap) break;
    const item = state.items[id]!;
    if (item.stock <= 0) continue;
    const priceRatio = item.price / Math.max(1, item.referencePrice);
    const priceMod = priceAttractiveness(priceRatio);
    const share = 1 / itemCount;
    const expected =
      baseTraffic * visitRate * share * (0.55 + service) * priceMod * 0.045;
    const demand = Math.max(
      0,
      Math.round(expected + ctx.rng.nextFloat(-1, 1)),
    );
    const sold = Math.min(item.stock, demand, throughputCap - covers);
    if (sold > 0) {
      item.stock -= sold;
      const rev = item.price * sold;
      const cogs = Math.round(item.cost * sold * pulse.cogsMultiplier);
      hourRevenue += rev;
      hourCogs += cogs;
      covers += sold;
    }
  }

  if (hourRevenue > 0) {
    ledgerEntries.push(
      ledger(
        `rev-${biz.id}-${ctx.tick}`,
        ctx.tick,
        hourRevenue,
        "revenue",
        "Truck sales",
        biz.id,
      ),
    );
    ledgerEntries.push(
      ledger(
        `cogs-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -hourCogs,
        "cogs",
        "Truck COGS",
        biz.id,
      ),
    );
  }

  // v0.10: graveyard hours (0-6, 22-23) cost 1.25× per the hours lever.
  const wageMul = hourlyWageMultiplier(ctx.tick);
  const wagesThisHour = Math.round(
    state.crew.reduce((a, c) => a + c.hourlyWageCents, 0) * wageMul,
  );
  state.wagesAccrued += wagesThisHour;
  state.weeklyRevenueAcc += hourRevenue;
  state.weeklyCogsAcc += hourCogs;
  state.weeklyCoversAcc += covers;

  const newCash = biz.cash + hourRevenue - hourCogs;

  // Truck condition decays ~0.02% per operating hour.
  state.truckCondition = Math.max(0.3, state.truckCondition - 0.0002);

  const updated: Business = {
    ...biz,
    cash: newCash,
    state: state as unknown as Record<string, unknown>,
    derived: {
      ...biz.derived,
      footTraffic: Math.round(baseTraffic * weather * routeMul * weekendMul),
      stockLevel: computeStockLevel(state),
      pendingWages: state.wagesAccrued,
      riskScore: Math.max(
        0,
        Math.min(
          100,
          20 +
            (weather < 0.6 ? 15 : 0) +
            (state.truckCondition < 0.5 ? 15 : 0) +
            ctx.rng.nextFloat(-4, 4),
        ),
      ),
    },
  };

  return { business: updated, ledger: ledgerEntries, events };
}

function onDay(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];
  let cash = biz.cash;

  // Roll weather once per in-game day. Use the integer day index from
  // the tick so it's stable within-day under repeated calls.
  const dayIndex = Math.floor(ctx.tick / 24);
  if (state.weatherRolledOnDayIndex !== dayIndex) {
    state.weatherToday = weatherRoll(ctx.rng.child(`truck-weather:${biz.id}:${dayIndex}`));
    state.weatherRolledOnDayIndex = dayIndex;
    if (state.weatherToday <= 0.4) {
      state.stormDaysThisWeek += 1;
      events.push({
        kind: "business_event",
        title: `${biz.name} washed out`,
        detail: "Storm hit the route — barely any foot traffic today.",
      });
    }
  }

  // Re-prep to par. Perishables waste if left in the truck.
  let restockCost = 0;
  let wasteUnits = 0;
  for (const id of Object.keys(state.items)) {
    const item = state.items[id]!;
    wasteUnits += Math.max(0, item.stock);
    const needed = item.dailyPar - item.stock;
    if (needed > 0) {
      const cost = item.cost * needed;
      if (cash >= cost) {
        item.stock += needed;
        cash -= cost;
        restockCost += cost;
      }
    }
  }
  if (restockCost > 0) {
    ledgerEntries.push(
      ledger(
        `restock-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -restockCost,
        "inventory_purchase",
        "Daily prep",
        biz.id,
      ),
    );
  }
  if (wasteUnits > 50) {
    // Big waste day ripples into morale.
    for (const c of state.crew) c.morale = Math.max(0, c.morale - 1);
  }

  // Crew drift.
  for (const c of state.crew) {
    c.morale = Math.max(0, Math.min(100, c.morale + ctx.rng.nextFloat(-3, 2.5)));
    c.skill = Math.min(100, c.skill + ctx.rng.nextFloat(0, 0.2));
  }

  // Sunday: street-cleaning maintenance — small capex nibble.
  if (dayOfWeek(ctx.tick) === 0 && state.truckCondition < 0.85) {
    const fix = dollars(75);
    if (cash >= fix) {
      cash -= fix;
      state.truckCondition = Math.min(0.95, state.truckCondition + 0.05);
      ledgerEntries.push(
        ledger(
          `truck-maint-${biz.id}-${ctx.tick}`,
          ctx.tick,
          -fix,
          "capex",
          "Truck maintenance",
          biz.id,
        ),
      );
    }
  }

  return {
    business: { ...biz, cash, state: state as unknown as Record<string, unknown> },
    ledger: ledgerEntries,
    events,
  };
}

function onWeek(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const ledgerEntries: LedgerEntry[] = [];
  let cash = biz.cash;

  // Pay wages.
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

  // Street-permit fee replaces rent.
  cash -= state.permitWeekly;
  ledgerEntries.push(
    ledger(
      `permit-${biz.id}-${ctx.tick}`,
      ctx.tick,
      -state.permitWeekly,
      "license_fee",
      "Street permit",
      biz.id,
    ),
  );

  // v0.10: channelized marketing.
  const weeklyMarketing = totalWeeklyMarketing(leversOf(biz));
  if (weeklyMarketing > 0) {
    cash -= weeklyMarketing;
    ledgerEntries.push(
      ledger(
        `mkt-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -weeklyMarketing,
        "marketing",
        "Social / stickers",
        biz.id,
      ),
    );
  }

  const weeklyRevenue = state.weeklyRevenueAcc;
  const weeklyExpenses =
    state.weeklyCogsAcc +
    state.wagesAccrued +
    state.permitWeekly +
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

  // CSAT drift by weather + service.
  const service = avgCrewService(state);
  // v0.10: 24/7 / 140+ hr/wk hours bonus. Rare for a food truck but possible.
  const hoursBonus = hoursCsatBonus(leversOf(biz).hours);
  const target =
    55 +
    service * 30 +
    (state.truckCondition - 0.5) * 15 +
    hoursBonus -
    state.stormDaysThisWeek * 3;
  const prev = biz.kpis.customerSatisfaction;
  const next = prev + (Math.max(0, Math.min(95, target)) - prev) * 0.25;

  // Reset weekly counters.
  state.weeklyRevenueAcc = 0;
  state.weeklyCogsAcc = 0;
  state.weeklyCoversAcc = 0;
  state.wagesAccrued = 0;
  state.stormDaysThisWeek = 0;

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
      state.stormDaysThisWeek >= 3
        ? [
            {
              kind: "business_event",
              title: `${biz.name} had a brutal weather week`,
              detail:
                "Three or more washout days this week. Consider a covered route or off-season savings.",
            },
          ]
        : [],
  };
}

function updateDerivedOnly(biz: Business, state: FoodTruckState): Business {
  return {
    ...biz,
    derived: {
      ...biz.derived,
      stockLevel: computeStockLevel(state),
      pendingWages: state.wagesAccrued,
    },
  };
}

function countSameTypeCompetitors(
  world: BusinessTickContext["world"],
  biz: Business,
): number {
  const market = world.markets[biz.locationId];
  if (!market) return 0;
  let n = 0;
  for (const id of market.businessIds) {
    if (id === biz.id) continue;
    const b = world.businesses[id];
    if (b && b.type === biz.type) n++;
  }
  return n;
}

// ---------- Module export ----------

export const foodTruckModule: BusinessTypeModule = {
  id: "food_truck",
  ui,
  startup,
  create: createBusiness,
  onHour,
  onDay,
  onWeek,
};

export { ROUTE as FOOD_TRUCK_ROUTES };
