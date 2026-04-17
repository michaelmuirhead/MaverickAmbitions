/**
 * Cafe / coffee-shop business module.
 *
 * This is the first business type whose dominant mechanic is NOT price
 * & inventory throughput. Cafes are a reputation flywheel:
 *
 *   barista craft + ambience + fair pricing
 *     → higher CSAT
 *       → higher per-cafe revenue (repeat visits + word of mouth)
 *         → halo bonus applied to ALL player businesses in this market
 *           (see engine/economy/reputation.ts)
 *
 * Player-visible knobs that matter:
 *   - Quality tier (basic / craft / premium) — cost & price ceiling
 *   - Barista hiring (craft & morale drive prep speed & quality)
 *   - Ambience refresh (periodic capex to keep the space inviting)
 *   - Menu pricing (fair = high CSAT; gouge = short-term profit, long-term rep loss)
 *
 * KPIs differ from corner store: we surface CSAT (primary), weekly
 * profit, daily covers, and the halo this cafe is contributing.
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

import { isBusinessHour } from "@/lib/date";
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
import { CAFE_MENU, type MenuItemId } from "@/data/menu";

import type {
  BusinessStartupSpec,
  BusinessTickContext,
  BusinessTickResult,
  BusinessTypeModule,
  BusinessUiDescriptor,
} from "./types";

// ---------- Type-specific state ----------

export type CafeQualityTier = "basic" | "craft" | "premium";

export interface CafeState {
  menu: Record<MenuItemId, CafeMenuItem>;
  baristas: Barista[];
  /** Owner-set; affects cost, price ceiling, and CSAT ceiling. */
  qualityTier: CafeQualityTier;
  /** 0..1, location chosen at open. */
  locationQuality: number;
  /** 0..1, decays ~1% per week, refreshed by ambience capex. */
  ambience: number;
  /** Tick at which ambience was last refreshed. */
  lastAmbienceRefreshTick: Tick;
  /** 0..1, effect of marketing. */
  marketingScore: number;
  rentMonthly: Cents;
  marketingWeekly: Cents;

  /** Weekly accumulators (reset on week close). */
  weeklyRevenueAcc: Cents;
  weeklyCogsAcc: Cents;
  weeklyCoversAcc: number;
  wagesAccrued: Cents;
  complaintsThisWeek: number;

  /** Short moving history of CSAT for smoothed flywheel. */
  csatHistory: number[]; // keep last 4 weeks
}

export interface CafeMenuItem {
  id: MenuItemId;
  cost: Cents;
  price: Cents;
  referencePrice: Cents;
  /** Prepared this morning; sold down over the day. */
  stock: number;
  dailyPar: number;
  prepSeconds: number;
}

export interface Barista {
  id: Id;
  name: string;
  hourlyWageCents: Cents;
  /** 0..100 craft — pulls up perceived quality & speeds prep. */
  craft: number;
  morale: number;
}

// ---------- Tier profiles ----------

interface TierProfile {
  costMultiplier: number;
  priceMultiplier: number;
  wageMultiplier: number;
  /** CSAT ceiling at this tier. */
  csatCeiling: number;
  ambienceFloor: number;
  startupCostMultiplier: number;
}

const TIER: Record<CafeQualityTier, TierProfile> = {
  basic:   { costMultiplier: 0.75, priceMultiplier: 0.80, wageMultiplier: 0.90, csatCeiling: 75, ambienceFloor: 0.4, startupCostMultiplier: 0.75 },
  craft:   { costMultiplier: 1.00, priceMultiplier: 1.00, wageMultiplier: 1.00, csatCeiling: 88, ambienceFloor: 0.55, startupCostMultiplier: 1.0 },
  premium: { costMultiplier: 1.35, priceMultiplier: 1.45, wageMultiplier: 1.25, csatCeiling: 95, ambienceFloor: 0.7, startupCostMultiplier: 1.5 },
};

// ---------- UI / startup ----------

const ui: BusinessUiDescriptor = {
  label: "Cafe",
  icon: "☕",
  kpiLabels: [
    "Customer Satisfaction",
    "Weekly Profit",
    "Daily Covers",
    "Reputation Halo",
  ],
  sections: ["menu", "staff", "pricing", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(75_000),
  minimumCreditScore: 620,
  requiredSkills: { management: 15 },
  unlocksAt: { netWorthCents: dollars(50_000) },
};

// ---------- Factory ----------

function buildInitialMenu(tier: TierProfile): Record<MenuItemId, CafeMenuItem> {
  const out: Record<MenuItemId, CafeMenuItem> = {} as Record<MenuItemId, CafeMenuItem>;
  for (const item of CAFE_MENU) {
    const cost = Math.round(item.baseCost * tier.costMultiplier);
    const price = Math.round(item.basePrice * tier.priceMultiplier);
    out[item.id] = {
      id: item.id,
      cost,
      price,
      referencePrice: price,
      stock: item.dailyPar,
      dailyPar: item.dailyPar,
      prepSeconds: item.prepSeconds,
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
  const tierKey: CafeQualityTier = "craft";
  const tier = TIER[tierKey];

  const state: CafeState = {
    menu: buildInitialMenu(tier),
    baristas: [
      {
        id: `${params.id}-barista-1`,
        name: "Barista Alpha",
        hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * tier.wageMultiplier * 1.1),
        craft: 55,
        morale: 72,
      },
      {
        id: `${params.id}-barista-2`,
        name: "Barista Beta",
        hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * tier.wageMultiplier),
        craft: 40,
        morale: 70,
      },
    ],
    qualityTier: tierKey,
    locationQuality: 0.6,
    ambience: 0.75,
    lastAmbienceRefreshTick: params.tick,
    marketingScore: 0.25,
    rentMonthly: Math.round(ECONOMY.BASE_RENT_MONTHLY_CENTS * 1.4), // cafes sit on nicer streets
    marketingWeekly: dollars(200),

    weeklyRevenueAcc: 0,
    weeklyCogsAcc: 0,
    weeklyCoversAcc: 0,
    wagesAccrued: 0,
    complaintsThisWeek: 0,

    csatHistory: [70],
  };

  const kpis: BusinessKPIs = {
    weeklyRevenue: 0,
    weeklyExpenses: 0,
    weeklyProfit: 0,
    marketShare: 0.1,
    customerSatisfaction: 72, // cafes open at slightly higher baseline than stores
  };

  const derived: BusinessDerived = {
    footTraffic: 0,
    stockLevel: 1,
    pendingWages: 0,
    riskScore: 8,
  };

  return {
    id: params.id,
    ownerId: params.ownerId,
    type: "cafe",
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

function getState(biz: Business): CafeState {
  // Deep-clone so in-place mutations inside onHour/onDay/onWeek don't touch
  // the frozen input state. The cloned tree is packaged back into the
  // returned Business via `state: state as ...`, keeping the module pure
  // from stepTick's point of view.
  return structuredClone(biz.state) as unknown as CafeState;
}

function computeStockLevel(state: CafeState): number {
  const values = Object.values(state.menu);
  if (values.length === 0) return 0;
  let pct = 0;
  for (const s of values) pct += Math.min(1, s.stock / Math.max(1, s.dailyPar));
  return pct / values.length;
}

function avgBaristaService(state: CafeState): number {
  if (state.baristas.length === 0) return 0;
  return (
    state.baristas.reduce((acc, b) => acc + (b.craft * b.morale) / 10000, 0) /
    state.baristas.length
  );
}

function competitorCafesInMarket(
  world: BusinessTickContext["world"],
  biz: Business,
): number {
  const market = world.markets[biz.locationId];
  if (!market) return 0;
  let n = 0;
  for (const id of market.businessIds) {
    if (id === biz.id) continue;
    const b = world.businesses[id];
    if (b && b.type === "cafe") n++;
  }
  return n;
}

/**
 * Hourly: serve customers. Uses menu prep time as a throughput ceiling,
 * then resolves demand per item with price elasticity and a service
 * multiplier driven by the CSAT flywheel.
 */
function onHour(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const market = ctx.world.markets[biz.locationId];
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];

  if (!market || !isBusinessHour(ctx.tick) || state.baristas.length === 0) {
    return {
      business: updateDerivedOnly(biz, state),
      ledger: [],
      events: [],
    };
  }

  // v0.5 macro-shock pulse: read once per hour, apply to traffic + COGS.
  const pulse = getPulseBundle(ctx.world.activeEvents ?? []);
  const trafficMul = pulse.trafficMultiplierByType.cafe ?? 1;

  const baseTraffic =
    marketFootTraffic(market, ctx.macro, ctx.tick) * trafficMul;
  const density = competitiveDensity(competitorCafesInMarket(ctx.world, biz));
  const service = avgBaristaService(state); // 0..1

  // Halo: our own CSAT contributes, but so does every other cafe we
  // own in this market. This is the flywheel made visible.
  const ownHalo = hospitalityHalo(ctx.world, biz.ownerId, biz.locationId);

  // CSAT flywheel pass-through: higher CSAT = more repeat visits.
  const csatBoost = Math.max(0.7, (biz.kpis.customerSatisfaction / 70));
  const ambienceBoost = 0.7 + state.ambience * 0.5;

  const visitRate =
    ECONOMY.BASE_VISIT_RATE *
    1.3 * // cafes have higher intent than corner stores
    (0.5 + state.marketingScore) *
    (0.6 + state.locationQuality) *
    csatBoost *
    (1 + ownHalo) *
    ambienceBoost /
    density;

  // Throughput cap: baristas can only prep so many items per hour.
  const baristaCraftAvg =
    state.baristas.reduce((a, b) => a + b.craft, 0) / state.baristas.length;
  const prepEfficiency = 0.6 + (baristaCraftAvg / 100) * 0.8; // 0.6..1.4
  const hourSeconds = 3600;
  // Effective prep seconds per order, weighted by menu composition.
  const weightedPrepSec =
    Object.values(state.menu).reduce((a, m) => a + m.prepSeconds, 0) /
    Math.max(1, Object.keys(state.menu).length);
  const maxCoversPerBaristaHour =
    (hourSeconds / Math.max(5, weightedPrepSec / prepEfficiency));
  const throughputCap = Math.round(
    maxCoversPerBaristaHour * state.baristas.length,
  );

  let hourRevenue = 0;
  let hourCogs = 0;
  let covers = 0;

  // Demand per menu item: traffic × visitRate × item-weight × priceElasticity × service.
  const items = Object.values(state.menu);
  const itemCount = Math.max(1, items.length);
  for (const menuId of Object.keys(state.menu) as MenuItemId[]) {
    if (covers >= throughputCap) break;
    const item = state.menu[menuId]!;
    if (item.stock <= 0) continue;
    const priceRatio = item.price / Math.max(1, item.referencePrice);
    const priceMod = priceAttractiveness(priceRatio);
    const share = 1 / itemCount; // uniform; refinable later by popularity
    const expected =
      baseTraffic * visitRate * share * (0.6 + service) * priceMod;
    const demand = Math.max(
      0,
      Math.round(expected + ctx.rng.nextFloat(-1, 1)),
    );
    const capRemaining = Math.max(0, throughputCap - covers);
    const sold = Math.min(item.stock, demand, capRemaining);

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

  // Stock-out & long-line complaints degrade CSAT via a counter we roll
  // up daily; record them here.
  const unmet = Math.max(0, Math.round(baseTraffic * visitRate) - covers);
  if (unmet > throughputCap * 0.4) state.complaintsThisWeek += 1;

  // Wages accrue.
  const wagesThisHour = state.baristas.reduce(
    (acc, b) => acc + b.hourlyWageCents,
    0,
  );
  state.wagesAccrued += wagesThisHour;

  state.weeklyRevenueAcc += hourRevenue;
  state.weeklyCogsAcc += hourCogs;
  state.weeklyCoversAcc += covers;

  const newCash = biz.cash + hourRevenue - hourCogs;

  const updated: Business = {
    ...biz,
    cash: newCash,
    state: state as unknown as Record<string, unknown>,
    derived: {
      ...biz.derived,
      footTraffic: baseTraffic,
      stockLevel: computeStockLevel(state),
      pendingWages: state.wagesAccrued,
      riskScore: Math.max(
        0,
        Math.min(
          100,
          25 - service * 30 + ctx.rng.nextFloat(-4, 4) +
            state.complaintsThisWeek * 1.5,
        ),
      ),
    },
  };

  return { business: updated, ledger: ledgerEntries, events };
}

/**
 * Daily: re-prep all menu items to par, morale walk, ambience decay.
 * Compute and post the daily CSAT delta (the flywheel).
 */
function onDay(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];
  let cash = biz.cash;

  // Prep inventory up to daily par. This is a fresh-goods category;
  // anything left over is waste.
  let restockCost = 0;
  let wasteUnits = 0;
  for (const menuId of Object.keys(state.menu) as MenuItemId[]) {
    const item = state.menu[menuId]!;
    wasteUnits += Math.max(0, item.stock); // unsold from yesterday
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
  // Waste penalty: small CSAT ding if we wasted a lot (over-prepped,
  // stale pastries vibe). Later: could add a waste ledger entry too.
  const wasteFactor = Math.min(1, wasteUnits / 200);

  // Morale & craft drift.
  for (const b of state.baristas) {
    b.morale = Math.max(0, Math.min(100, b.morale + ctx.rng.nextFloat(-3, 2.5)));
    b.craft = Math.min(100, b.craft + ctx.rng.nextFloat(0, 0.25));
  }

  // Ambience decay (~1% per week → ~0.14% per day).
  state.ambience = Math.max(
    TIER[state.qualityTier].ambienceFloor,
    state.ambience - 0.0015,
  );

  // --- THE FLYWHEEL: daily CSAT update ---
  const tier = TIER[state.qualityTier];
  const service = avgBaristaService(state);
  // Average price-fairness across menu (1.0 = at reference).
  const avgPriceRatio =
    Object.values(state.menu).reduce(
      (a, m) => a + m.price / Math.max(1, m.referencePrice),
      0,
    ) / Math.max(1, Object.keys(state.menu).length);
  const priceFairness = priceAttractiveness(avgPriceRatio); // 0.25..1.5

  const target =
    50 +
    service * 35 + // service quality is most of the signal
    (state.ambience - 0.5) * 20 +
    (priceFairness - 1) * 10 +
    (state.marketingScore - 0.3) * 5 -
    wasteFactor * 4 -
    state.complaintsThisWeek * 1.2;

  // Pull CSAT toward target (bounded by tier ceiling).
  const ceiling = tier.csatCeiling;
  const clampedTarget = Math.max(0, Math.min(ceiling, target));
  const prev = biz.kpis.customerSatisfaction;
  const next = prev + (clampedTarget - prev) * 0.15; // 15% pull per day

  // Occasional milestone event when CSAT crosses 85.
  if (prev < 85 && next >= 85) {
    events.push({
      kind: "milestone",
      title: `${biz.name} is getting buzz`,
      detail: `Customers are raving. The cafe crossed a CSAT of 85.`,
      impact: { reputationDelta: 1 },
    });
  }
  if (prev > 60 && next <= 55) {
    events.push({
      kind: "business_event",
      title: `Reviews are turning on ${biz.name}`,
      detail: "A string of bad days dropped the cafe below CSAT 55.",
      impact: { reputationDelta: -1 },
    });
  }

  return {
    business: {
      ...biz,
      cash,
      state: state as unknown as Record<string, unknown>,
      kpis: { ...biz.kpis, customerSatisfaction: next },
    },
    ledger: ledgerEntries,
    events,
  };
}

/**
 * Weekly: wages, rent, marketing, ambience capex, tax, book profit.
 * Record a CSAT history point for flywheel smoothing.
 */
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

  // Rent — weekly slice of monthly.
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

  // Marketing.
  if (state.marketingWeekly > 0) {
    cash -= state.marketingWeekly;
    ledgerEntries.push(
      ledger(
        `mkt-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -state.marketingWeekly,
        "marketing",
        "Weekly marketing",
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

  // Ambience decays more visibly weekly.
  state.ambience = Math.max(
    TIER[state.qualityTier].ambienceFloor,
    state.ambience - 0.01,
  );

  // Weekly KPIs.
  const weeklyRevenue = state.weeklyRevenueAcc;
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

  // CSAT history (4-week ring).
  const nextHistory = [
    ...state.csatHistory.slice(-3),
    biz.kpis.customerSatisfaction,
  ];
  state.csatHistory = nextHistory;

  // Reset weekly counters (but NOT CSAT — it's carried in KPIs).
  state.weeklyRevenueAcc = 0;
  state.weeklyCogsAcc = 0;
  state.weeklyCoversAcc = 0;
  state.wagesAccrued = 0;
  state.complaintsThisWeek = 0;

  const kpis: BusinessKPIs = {
    ...biz.kpis,
    weeklyRevenue,
    weeklyExpenses,
    weeklyProfit,
    // marketShare not yet meaningfully computed for cafes — leave last value.
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
              title: `${biz.name} is bleeding`,
              detail:
                "Low CSAT and negative profit — raise quality, cut prices, or the cafe will close.",
            },
          ]
        : [],
  };
}

function updateDerivedOnly(biz: Business, state: CafeState): Business {
  return {
    ...biz,
    derived: {
      ...biz.derived,
      stockLevel: computeStockLevel(state),
      pendingWages: state.wagesAccrued,
    },
  };
}

// ---------- Module export ----------

export const cafeModule: BusinessTypeModule = {
  id: "cafe",
  ui,
  startup,
  create: createBusiness,
  onHour,
  onDay,
  onWeek,
};

export { TIER as CAFE_TIER_PROFILES };
