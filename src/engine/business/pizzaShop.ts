/**
 * Pizza shop — the delivery vs dine-in trade-off.
 *
 * Distinctive mechanics vs cafe/restaurant:
 *   - Revenue splits across TWO channels: dine-in and delivery.
 *   - Dine-in throughput gates on the oven's hourly pies; delivery
 *     throughput gates on the number of drivers on shift and their
 *     average round-trip time.
 *   - Delivery orders pay a higher ticket (tip margin is real) but
 *     cost more per order (driver wages + fuel + app commissions).
 *   - Macro "viral_food_trend" gives the same pulse cafes get for
 *     hospitality — pizza is a hospitality class for trend purposes.
 *   - Delivery app commissions are a flat 18% rake on delivery revenue,
 *     modeling DoorDash/UberEats. Going "in-house delivery only" is a
 *     later toggle (v0.9 item) — for now it's automatic.
 *
 * Strategic shape:
 *   Under $150K startup, positioned alongside bar. The delivery channel
 *   gives it weather-resilience — stormy days _hurt_ a food truck but
 *   _help_ a pizza shop. This is the flavor that makes the two food-
 *   service modules feel different rather than redundant.
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

import { isBusinessHour, tickToDate } from "@/lib/date";
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

// ---------- State ----------

export interface PizzaMenuItem {
  id: string;
  name: string;
  cost: Cents;
  price: Cents;
  referencePrice: Cents;
  prepSeconds: number;
  /** True if this item is also offered on delivery. Small sides are dine-in only. */
  delivery: boolean;
}

export interface PizzaStaff {
  id: Id;
  name: string;
  role: "cook" | "counter" | "driver";
  hourlyWageCents: Cents;
  skill: number;
  morale: number;
}

export interface PizzaShopState {
  menu: Record<string, PizzaMenuItem>;
  staff: PizzaStaff[];
  locationQuality: number;
  /** 0..1. */
  marketingScore: number;
  rentMonthly: Cents;
  marketingWeekly: Cents;
  /** Platform commission rake on delivery revenue (0.18 by default). */
  deliveryCommissionRate: number;
  /** Per-delivery flat fuel cost in cents. */
  deliveryFuelCostPerOrder: Cents;
  /** Minutes, per driver, per round-trip on average. */
  avgDeliveryRoundTripMin: number;

  weeklyRevenueDineIn: Cents;
  weeklyRevenueDelivery: Cents;
  weeklyCogsAcc: Cents;
  weeklyDeliveryCommissionAcc: Cents;
  weeklyDeliveryFuelAcc: Cents;
  wagesAccrued: Cents;
  weeklyCoversAcc: number;
}

// ---------- UI / startup ----------

const ui: BusinessUiDescriptor = {
  label: "Pizza Shop",
  icon: "🍕",
  kpiLabels: [
    "Weekly Profit",
    "Dine-In / Delivery Split",
    "Delivery Commissions",
    "Customer Satisfaction",
  ],
  sections: ["menu", "staff", "pricing", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(140_000),
  minimumCreditScore: 620,
  unlocksAt: { netWorthCents: dollars(80_000) },
};

// ---------- Menu ----------

const DEFAULT_MENU: PizzaMenuItem[] = [
  { id: "slice",       name: "Cheese Slice",       cost: 80,  price: 450,  referencePrice: 450,  prepSeconds: 30,  delivery: false },
  { id: "pie_plain",   name: "Plain Pie",          cost: 320, price: 1800, referencePrice: 1800, prepSeconds: 240, delivery: true  },
  { id: "pie_supreme", name: "Supreme Pie",        cost: 460, price: 2600, referencePrice: 2600, prepSeconds: 260, delivery: true  },
  { id: "pie_meat",    name: "Meat Lover's",       cost: 520, price: 2800, referencePrice: 2800, prepSeconds: 270, delivery: true  },
  { id: "calzone",     name: "Calzone",            cost: 290, price: 1400, referencePrice: 1400, prepSeconds: 200, delivery: true  },
  { id: "wings",       name: "Wings (10)",         cost: 280, price: 1600, referencePrice: 1600, prepSeconds: 240, delivery: true  },
  { id: "garlic_bread",name: "Garlic Bread",       cost: 70,  price: 450,  referencePrice: 450,  prepSeconds: 90,  delivery: true  },
  { id: "soda_2l",     name: "2L Soda",            cost: 80,  price: 450,  referencePrice: 450,  prepSeconds: 5,   delivery: true  },
];

function buildMenu(): Record<string, PizzaMenuItem> {
  const out: Record<string, PizzaMenuItem> = {};
  for (const m of DEFAULT_MENU) out[m.id] = { ...m };
  return out;
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
  const state: PizzaShopState = {
    menu: buildMenu(),
    staff: [
      { id: `${params.id}-cook`,    name: "Cook Alpha",    role: "cook",    hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.25), skill: 55, morale: 70 },
      { id: `${params.id}-counter`, name: "Counter Alpha", role: "counter", hourlyWageCents: ECONOMY.BASE_HOURLY_WAGE_CENTS, skill: 45, morale: 68 },
      { id: `${params.id}-driver1`, name: "Driver Alpha",  role: "driver",  hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 0.95), skill: 50, morale: 65 },
      { id: `${params.id}-driver2`, name: "Driver Beta",   role: "driver",  hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 0.95), skill: 45, morale: 65 },
    ],
    locationQuality: 0.55,
    marketingScore: 0.25,
    rentMonthly: Math.round(ECONOMY.BASE_RENT_MONTHLY_CENTS * 1.2),
    marketingWeekly: dollars(250),
    deliveryCommissionRate: 0.18,
    deliveryFuelCostPerOrder: dollars(1.5),
    avgDeliveryRoundTripMin: 28,

    weeklyRevenueDineIn: 0,
    weeklyRevenueDelivery: 0,
    weeklyCogsAcc: 0,
    weeklyDeliveryCommissionAcc: 0,
    weeklyDeliveryFuelAcc: 0,
    wagesAccrued: 0,
    weeklyCoversAcc: 0,
  };

  const kpis: BusinessKPIs = {
    weeklyRevenue: 0,
    weeklyExpenses: 0,
    weeklyProfit: 0,
    marketShare: 0.08,
    customerSatisfaction: 70,
  };

  const derived: BusinessDerived = {
    footTraffic: 0,
    stockLevel: 1,
    pendingWages: 0,
    riskScore: 12,
  };

  return {
    id: params.id,
    ownerId: params.ownerId,
    type: "pizza_shop",
    name: params.name,
    locationId: params.locationId,
    openedAtTick: params.tick,
    cash: dollars(10_000),
    state: state as unknown as Record<string, unknown>,
    kpis,
    derived,
  };
}

// ---------- Simulation ----------

function getState(biz: Business): PizzaShopState {
  return structuredClone(biz.state) as unknown as PizzaShopState;
}

function competitors(ctx: BusinessTickContext, biz: Business): number {
  const market = ctx.world.markets[biz.locationId];
  if (!market) return 0;
  let n = 0;
  for (const id of market.businessIds) {
    if (id === biz.id) continue;
    const b = ctx.world.businesses[id];
    if (b && (b.type === "pizza_shop" || b.type === "restaurant")) n++;
  }
  return n;
}

function rolesOnShift(state: PizzaShopState): {
  cooks: number;
  counter: number;
  drivers: number;
} {
  let cooks = 0;
  let counter = 0;
  let drivers = 0;
  for (const s of state.staff) {
    if (s.role === "cook") cooks++;
    else if (s.role === "counter") counter++;
    else drivers++;
  }
  return { cooks, counter, drivers };
}

function avgService(state: PizzaShopState): number {
  if (state.staff.length === 0) return 0;
  return (
    state.staff.reduce((a, s) => a + (s.skill * s.morale) / 10000, 0) /
    state.staff.length
  );
}

function onHour(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const market = ctx.world.markets[biz.locationId];
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];

  const { cooks, counter, drivers } = rolesOnShift(state);
  if (!market || !isBusinessHour(ctx.tick) || cooks === 0) {
    return { business: updateDerivedOnly(biz, state), ledger: [], events: [] };
  }

  const pulse = getPulseBundle(ctx.world.activeEvents ?? []);
  // Pizza leans hospitality for trend pulses (cafe/bar/restaurant).
  const trafficMul = pulse.trafficMultiplierByType.restaurant ?? 1;

  const baseTraffic = marketFootTraffic(market, ctx.macro, ctx.tick) * trafficMul;
  const density = competitiveDensity(competitors(ctx, biz));
  const service = avgService(state);
  const ownHalo = hospitalityHalo(ctx.world, biz.ownerId, biz.locationId);

  // Dine-in demand scales with storefront foot traffic.
  const dineInVisitRate =
    ECONOMY.BASE_VISIT_RATE *
    1.4 *
    (0.5 + state.marketingScore) *
    (0.6 + state.locationQuality) *
    (1 + ownHalo) /
    density;

  // Delivery demand scales with market population + marketing, not foot traffic.
  // Night hours and weekend bumps are where delivery earns its keep.
  const hour = hourOf(ctx.tick);
  const isEvening = hour >= 17 && hour <= 23;
  const deliveryDemandBase =
    market.population * 0.00018 * ctx.macro.consumerWallet * trafficMul;
  const deliveryDemand =
    deliveryDemandBase *
    (0.5 + state.marketingScore) *
    (isEvening ? 1.6 : 0.7);

  // Throughput caps.
  // Oven: cooks × 30 pies/hour equivalent. Measured in "pie-equivalents".
  // Counter: capped at ~30 dine-in orders/hour per counter staff.
  // Drivers: trips per hour = 60 / avgDeliveryRoundTripMin.
  const ovenCapPieEquivs = cooks * 30;
  const counterCap = Math.max(0, counter) * 30;
  const tripsPerDriver = Math.max(1, Math.floor(60 / state.avgDeliveryRoundTripMin));
  const deliveryCap = drivers * tripsPerDriver;

  // --- Dine-in pass ---
  let dineInRevenue = 0;
  let dineInCogs = 0;
  let dineInOrders = 0;
  let ovenUsed = 0;
  for (const id of Object.keys(state.menu)) {
    const item = state.menu[id]!;
    if (dineInOrders >= counterCap) break;
    const priceMod = priceAttractiveness(item.price / Math.max(1, item.referencePrice));
    const expected =
      baseTraffic * dineInVisitRate * (0.55 + service) * priceMod * 0.035;
    const demand = Math.max(
      0,
      Math.round(expected + ctx.rng.nextFloat(-1, 1)),
    );
    // "Pie-equivalents" — a slice is 1/8, a pie is 1, others are ~0.5.
    const pieWeight =
      item.id === "slice" ? 0.125 : item.id.startsWith("pie_") ? 1 : 0.5;
    const ovenRoom = Math.max(0, ovenCapPieEquivs - ovenUsed);
    const ovenCanMake = Math.floor(ovenRoom / Math.max(0.1, pieWeight));
    const sold = Math.min(demand, counterCap - dineInOrders, ovenCanMake);
    if (sold > 0) {
      const rev = item.price * sold;
      const cogs = Math.round(item.cost * sold * pulse.cogsMultiplier);
      dineInRevenue += rev;
      dineInCogs += cogs;
      dineInOrders += sold;
      ovenUsed += sold * pieWeight;
    }
  }

  // --- Delivery pass ---
  let deliveryRevenue = 0;
  let deliveryCogs = 0;
  let deliveryOrders = 0;
  if (drivers > 0) {
    // Only delivery-eligible items; each order averages ~1.1 pies + 1 side.
    const deliveryItems = Object.values(state.menu).filter((m) => m.delivery);
    const avgTicketCost =
      deliveryItems.reduce((a, m) => a + m.cost, 0) / deliveryItems.length;
    const avgTicketPrice =
      deliveryItems.reduce((a, m) => a + m.price, 0) / deliveryItems.length;

    const priceRatio = avgTicketPrice /
      (deliveryItems.reduce((a, m) => a + m.referencePrice, 0) /
        Math.max(1, deliveryItems.length));
    const priceMod = priceAttractiveness(priceRatio);
    const expected = deliveryDemand * priceMod;
    const demand = Math.max(
      0,
      Math.round(expected + ctx.rng.nextFloat(-1.5, 1.5)),
    );
    // Oven also bottlenecks delivery — a typical delivery ticket is ~1.3 pie-equivalents.
    const ovenRoom = Math.max(0, ovenCapPieEquivs - ovenUsed);
    const ovenCanMake = Math.floor(ovenRoom / 1.3);
    deliveryOrders = Math.min(demand, deliveryCap, ovenCanMake);

    if (deliveryOrders > 0) {
      const rev = Math.round(avgTicketPrice * deliveryOrders);
      const cogs = Math.round(
        avgTicketCost * deliveryOrders * pulse.cogsMultiplier,
      );
      deliveryRevenue = rev;
      deliveryCogs = cogs;
      ovenUsed += deliveryOrders * 1.3;
    }
  }

  // Ledger.
  if (dineInRevenue > 0) {
    ledgerEntries.push(
      ledger(
        `rev-din-${biz.id}-${ctx.tick}`,
        ctx.tick,
        dineInRevenue,
        "revenue",
        "Dine-in sales",
        biz.id,
      ),
    );
  }
  if (deliveryRevenue > 0) {
    ledgerEntries.push(
      ledger(
        `rev-del-${biz.id}-${ctx.tick}`,
        ctx.tick,
        deliveryRevenue,
        "revenue",
        "Delivery sales",
        biz.id,
      ),
    );
    // Platform commission + fuel charge logged as separate negative entries.
    const commission = Math.round(deliveryRevenue * state.deliveryCommissionRate);
    const fuel = state.deliveryFuelCostPerOrder * deliveryOrders;
    state.weeklyDeliveryCommissionAcc += commission;
    state.weeklyDeliveryFuelAcc += fuel;
    ledgerEntries.push(
      ledger(
        `comm-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -commission,
        "marketing",
        "Delivery app commission",
        biz.id,
      ),
    );
    ledgerEntries.push(
      ledger(
        `fuel-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -fuel,
        "utilities",
        "Driver fuel",
        biz.id,
      ),
    );
  }

  const cogsTotal = dineInCogs + deliveryCogs;
  if (cogsTotal > 0) {
    ledgerEntries.push(
      ledger(
        `cogs-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -cogsTotal,
        "cogs",
        "Food COGS",
        biz.id,
      ),
    );
  }

  // Wages accrue.
  const wagesThisHour = state.staff.reduce((a, s) => a + s.hourlyWageCents, 0);
  state.wagesAccrued += wagesThisHour;

  state.weeklyRevenueDineIn += dineInRevenue;
  state.weeklyRevenueDelivery += deliveryRevenue;
  state.weeklyCogsAcc += cogsTotal;
  state.weeklyCoversAcc += dineInOrders + deliveryOrders;

  // Cash updates — commission + fuel come out immediately too.
  const commissionThisHour =
    deliveryRevenue > 0
      ? Math.round(deliveryRevenue * state.deliveryCommissionRate)
      : 0;
  const fuelThisHour =
    deliveryOrders > 0 ? state.deliveryFuelCostPerOrder * deliveryOrders : 0;
  const newCash =
    biz.cash +
    dineInRevenue +
    deliveryRevenue -
    cogsTotal -
    commissionThisHour -
    fuelThisHour;

  const updated: Business = {
    ...biz,
    cash: newCash,
    state: state as unknown as Record<string, unknown>,
    derived: {
      ...biz.derived,
      footTraffic: baseTraffic,
      stockLevel: 1 - Math.min(1, ovenUsed / Math.max(1, ovenCapPieEquivs)),
      pendingWages: state.wagesAccrued,
      riskScore: Math.max(
        0,
        Math.min(100, 15 + (drivers === 0 ? 20 : 0) - service * 20 + ctx.rng.nextFloat(-5, 5)),
      ),
    },
  };

  return { business: updated, ledger: ledgerEntries, events };
}

function onDay(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  // Pizza shop has continuous prep — no daily par refill. Dough is made ad hoc.
  // Just drift staff morale and a small CSAT nudge.
  for (const s of state.staff) {
    s.morale = Math.max(0, Math.min(100, s.morale + ctx.rng.nextFloat(-3, 2.5)));
    s.skill = Math.min(100, s.skill + ctx.rng.nextFloat(0, 0.2));
  }

  return {
    business: {
      ...biz,
      state: state as unknown as Record<string, unknown>,
    },
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

  if (state.marketingWeekly > 0) {
    cash -= state.marketingWeekly;
    ledgerEntries.push(
      ledger(
        `mkt-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -state.marketingWeekly,
        "marketing",
        "Local flyers / social",
        biz.id,
      ),
    );
    state.marketingScore = Math.min(
      1,
      state.marketingScore * 0.65 +
        Math.min(1, state.marketingWeekly / dollars(500)) * 0.35,
    );
  } else {
    state.marketingScore *= 0.65;
  }

  // Weekly KPIs.
  const dineIn = state.weeklyRevenueDineIn;
  const delivery = state.weeklyRevenueDelivery;
  const weeklyRevenue = dineIn + delivery;
  const weeklyExpenses =
    state.weeklyCogsAcc +
    state.wagesAccrued +
    weeklyRent +
    state.marketingWeekly +
    state.weeklyDeliveryCommissionAcc +
    state.weeklyDeliveryFuelAcc;
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

  // CSAT drift by service + price.
  const service = avgService(state);
  const target = 55 + service * 30 + state.marketingScore * 5;
  const next =
    biz.kpis.customerSatisfaction +
    (Math.max(0, Math.min(90, target)) - biz.kpis.customerSatisfaction) * 0.2;

  // Reset weekly.
  state.weeklyRevenueDineIn = 0;
  state.weeklyRevenueDelivery = 0;
  state.weeklyCogsAcc = 0;
  state.weeklyDeliveryCommissionAcc = 0;
  state.weeklyDeliveryFuelAcc = 0;
  state.wagesAccrued = 0;
  state.weeklyCoversAcc = 0;

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
      delivery > dineIn * 3 && weeklyProfit > 0
        ? [
            {
              kind: "milestone",
              title: `${biz.name} is a delivery powerhouse`,
              detail:
                "Delivery is more than 3× your dine-in revenue. Consider a dedicated dispatcher.",
            },
          ]
        : [],
  };
}

function updateDerivedOnly(biz: Business, state: PizzaShopState): Business {
  return {
    ...biz,
    derived: {
      ...biz.derived,
      pendingWages: state.wagesAccrued,
    },
  };
}

// ---------- Module export ----------

export const pizzaShopModule: BusinessTypeModule = {
  id: "pizza_shop",
  ui,
  startup,
  create: createBusiness,
  onHour,
  onDay,
  onWeek,
};
