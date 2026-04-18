/**
 * Corner-store / small-retail business module.
 *
 * The first business type. Designed so the interfaces it exercises
 * (inventory, staff, pricing, foot traffic) are the SAME interfaces
 * that will later power cafes, tech startups, and (abstracted) sports
 * teams, cities, and nations.
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

import { HOURS_PER_WEEK } from "@/lib/date";
import { dollars, percentOf } from "@/lib/money";

import { ECONOMY } from "../economy/constants";
import { corporateTax, ledger } from "../economy/finance";
import { getPulseBundle } from "../macro/events";
import {
  competitiveDensity,
  marketBasketMultiplier,
  marketFootTraffic,
  priceAttractiveness,
} from "../economy/market";
import { hospitalityHalo } from "../economy/reputation";
import {
  currentPromoPctOff,
  effectiveMarketingScore,
  hourlyWageMultiplier,
  hoursCsatBonus,
  isBusinessOpenNow,
  leversOf,
  promotionCsatDelta,
  promotionTrafficLift,
  totalWeeklyMarketing,
} from "./leverState";
import { STARTER_SKUS, type SkuId } from "@/data/items";

import type {
  BusinessStartupSpec,
  BusinessTickContext,
  BusinessTickResult,
  BusinessTypeModule,
  BusinessUiDescriptor,
} from "./types";

// ---------- Type-specific state shape ----------

export interface CornerStoreState {
  /** SKU → inventory record. */
  skus: Record<SkuId, CornerStoreSku>;
  staff: CornerStoreStaff[];
  /** 0..1. Location quality chosen at open time. */
  locationQuality: number;
  /** Rent per month (cents). */
  rentMonthly: Cents;
  /** Weekly revenue accumulator (resets Sunday midnight). */
  weeklyRevenueAcc: Cents;
  /** Weekly COGS accumulator. */
  weeklyCogsAcc: Cents;
  /** Wages accrued this week (paid on week close). */
  wagesAccrued: Cents;
  /** v0.8.1: estimated visitors accumulated across the week. */
  weeklyVisitorsAcc?: number;
  /** v0.8.1: units sold accumulated across the week. */
  weeklyUnitsSoldAcc?: number;
}

export interface CornerStoreSku {
  skuId: SkuId;
  cost: Cents; // per-unit wholesale cost
  price: Cents; // per-unit retail price
  referencePrice: Cents; // suggested market price
  stock: number;
  restockThreshold: number;
  restockBatch: number;
}

export interface CornerStoreStaff {
  id: Id;
  name: string;
  hourlyWageCents: Cents;
  skill: number; // 0..100
  morale: number; // 0..100
}

// ---------- Startup / UI ----------

const ui: BusinessUiDescriptor = {
  label: "Corner Store",
  icon: "🏪",
  kpiLabels: [
    "Weekly Revenue",
    "Weekly Profit",
    "Customer Satisfaction",
    "Stock Level",
  ],
  sections: ["inventory", "staff", "pricing", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(35_000),
  minimumCreditScore: 580,
};

// ---------- Factory ----------

function buildInitialSkus(): Record<SkuId, CornerStoreSku> {
  const out: Record<SkuId, CornerStoreSku> = {} as Record<SkuId, CornerStoreSku>;
  for (const sku of STARTER_SKUS) {
    out[sku.id] = {
      skuId: sku.id,
      cost: sku.baseCost,
      price: sku.basePrice,
      referencePrice: sku.basePrice,
      stock: sku.initialStock,
      restockThreshold: Math.floor(sku.initialStock * 0.25),
      // v0.10.1 balance pass: restockBatch refills to ~50% of initial
      // rather than all the way back to full (which was over-buying
      // inventory and inflating apparent weekly COGS). The starter
      // store still carries 6 weeks of cola on the shelf — plenty —
      // while new restocks are sized to ~actual sell-through.
      restockBatch: Math.max(1, Math.floor(sku.initialStock * 0.5)),
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
  const state: CornerStoreState = {
    skus: buildInitialSkus(),
    staff: [
      // v0.10.1 balance pass: starter clerk is a $14/hr part-timer rather
      // than the $18 base retail wage. A 168-hour/wk business can't clear
      // its nut on the base wage in week 1 — the part-timer starting rate
      // gives the player a fighting chance before they hire up.
      {
        id: `${params.id}-clerk-1`,
        name: "Clerk Alpha",
        hourlyWageCents: 1400,
        skill: 45,
        morale: 70,
      },
    ],
    locationQuality: 0.55,
    rentMonthly: ECONOMY.BASE_RENT_MONTHLY_CENTS,
    weeklyRevenueAcc: 0,
    weeklyCogsAcc: 0,
    wagesAccrued: 0,
    weeklyVisitorsAcc: 0,
    weeklyUnitsSoldAcc: 0,
  };

  const kpis: BusinessKPIs = {
    weeklyRevenue: 0,
    weeklyExpenses: 0,
    weeklyProfit: 0,
    marketShare: 0.1,
    customerSatisfaction: 70,
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
    type: "corner_store",
    name: params.name,
    locationId: params.locationId,
    openedAtTick: params.tick,
    // v0.10.1 balance pass: 8k of operating cash left after buildout
    // (was 5k). The extra 3k buys ~1.5 weeks of restock runway so a
    // well-run store isn't forced into an empty-shelves death spiral
    // before marketing / pricing levers have had time to take effect.
    cash: dollars(8_000),
    state: state as unknown as Record<string, unknown>,
    kpis,
    derived,
  };
}

// ---------- Simulation ----------

function getState(biz: Business): CornerStoreState {
  // Deep-clone so in-place mutations inside onHour/onDay/onWeek don't touch
  // the frozen input state. The cloned tree is packaged back into the
  // returned Business via `state: state as ...`, keeping the module pure
  // from stepTick's point of view.
  return structuredClone(biz.state) as unknown as CornerStoreState;
}

function computeStockLevel(state: CornerStoreState): number {
  const values = Object.values(state.skus);
  if (values.length === 0) return 0;
  let pct = 0;
  for (const s of values) {
    pct += Math.min(1, s.stock / Math.max(1, s.restockBatch));
  }
  return pct / values.length;
}

function competitorCountInMarket(
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

/**
 * Hourly simulation: sells product if it's business hours.
 */
function onHour(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const market = ctx.world.markets[biz.locationId];
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];

  if (!market || !isBusinessOpenNow(biz, ctx.tick) || state.staff.length === 0) {
    return {
      business: updateDerived(biz, state),
      ledger: [],
      events: [],
    };
  }

  // v0.5 macro-shock pulse: corner stores get COGS bite from
  // commodity_shortage. Traffic multiplier currently only keys cafe/bar/restaurant.
  const pulse = getPulseBundle(ctx.world.activeEvents ?? []);

  // v0.10: active promotion pulls a traffic lift (capped +40% at deep
  // discounts); SKU prices are discounted below.
  const promo = leversOf(biz).promotion;
  const promoDisc = currentPromoPctOff(promo, ctx.tick);
  const trafficLift = promotionTrafficLift(promo, ctx.tick);
  const traffic =
    marketFootTraffic(market, ctx.macro, ctx.tick) * trafficLift;
  const density = competitiveDensity(competitorCountInMarket(ctx.world, biz));

  // Service quality from staff (average morale * skill).
  const avgService =
    state.staff.reduce((acc, s) => acc + (s.skill * s.morale) / 10000, 0) /
    state.staff.length;

  // Hospitality halo: if this owner runs high-CSAT cafes in this neighborhood,
  // they get a traffic bump here too — the empire flywheel.
  const halo = hospitalityHalo(ctx.world, biz.ownerId, biz.locationId);

  const marketingScore = effectiveMarketingScore(leversOf(biz), market);
  const visitRate =
    ECONOMY.BASE_VISIT_RATE *
    (0.5 + marketingScore) *
    (0.5 + state.locationQuality) *
    (1 + halo) /
    density;

  let hourRevenue = 0;
  let hourCogs = 0;
  let hourUnitsSold = 0;

  // Iterate SKUs: for each, a simple probabilistic sale rate.
  for (const skuId of Object.keys(state.skus) as SkuId[]) {
    const sku = state.skus[skuId]!;
    if (sku.stock <= 0) continue;

    // Effective price under active promotion is (1 - discount) × sticker.
    const effectivePrice = Math.max(1, Math.round(sku.price * (1 - promoDisc)));
    const priceRatio = effectivePrice / Math.max(1, sku.referencePrice);
    const priceMod = priceAttractiveness(priceRatio);
    const conversion = ECONOMY.BASE_CONVERSION * priceMod * (0.6 + avgService);

    // Expected buyers for this SKU in this hour. v0.10.1 balance pass:
    // bumped per-SKU scale from 0.05 → 0.22 so traffic / visitRate /
    // desirability translate into visible revenue swings, and so a
    // well-run starter store in any reasonable market (≥50% desirability)
    // can clear its nut by week 1–2, not just the single highest-end one.
    const expected = traffic * visitRate * conversion * 0.22;
    // v0.10.1 balance pass: switched noise model from additive `expected
    // + rng(-1, 1)` to a Poisson-like `floor(expected) + Bernoulli(frac)`.
    // With the additive model, the ±1 term dominated whenever expected
    // was small (< 0.5), capping each slot at "0 or 1 with ~30% chance
    // regardless of traffic" — so bumping traffic or visit rate barely
    // moved revenue. The Poisson model preserves E[units] = expected
    // exactly, so upstream tuning is finally load-bearing.
    const whole = Math.floor(expected);
    const frac = expected - whole;
    const stochastic = ctx.rng.nextFloat(0, 1) < frac ? 1 : 0;
    const unitsSold = Math.min(sku.stock, Math.max(0, whole + stochastic));

    if (unitsSold > 0) {
      sku.stock -= unitsSold;
      // v0.10.1 second-pass: wealthy neighborhoods buy bigger baskets
      // per visit. Applied to revenue (not COGS) — the customer's buying
      // more items at retail, not changing what each item costs us.
      const basket = marketBasketMultiplier(market);
      const rev = Math.round(effectivePrice * unitsSold * basket);
      const cogs = Math.round(sku.cost * unitsSold * pulse.cogsMultiplier);
      hourRevenue += rev;
      hourCogs += cogs;
      hourUnitsSold += unitsSold;
    }
  }

  if (hourRevenue > 0) {
    ledgerEntries.push(
      ledger(
        `rev-${biz.id}-${ctx.tick}`,
        ctx.tick,
        hourRevenue,
        "revenue",
        "Hourly sales",
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

  // Accrue wages for the hour (one hourly wage per staff on duty).
  // v0.10: graveyard shifts (0-6, 22-23) bill at 1.25× per the hours lever.
  const activeStaff = state.staff.length;
  const wageMul = hourlyWageMultiplier(ctx.tick);
  const wagesThisHour = Math.round(
    state.staff.reduce((acc, s) => acc + s.hourlyWageCents, 0) * wageMul,
  );
  state.wagesAccrued += wagesThisHour;

  state.weeklyRevenueAcc += hourRevenue;
  state.weeklyCogsAcc += hourCogs;

  // v0.8.1: accumulate weekly traffic + units for the conversion KPI.
  const visitorsThisHour = traffic * visitRate;
  state.weeklyVisitorsAcc = (state.weeklyVisitorsAcc ?? 0) + visitorsThisHour;
  state.weeklyUnitsSoldAcc = (state.weeklyUnitsSoldAcc ?? 0) + hourUnitsSold;

  // v0.10.1 balance pass: cash is debited by inventory purchases in
  // `onDay` (see restock block). The hourly `cogs` ledger entry is kept
  // for P&L / KPI reporting — but we must NOT debit cash here a second
  // time, or every unit is charged to cash twice (once when bought,
  // once when sold). That double-debit was the source of the illusory
  // ~13% gross margin we saw in probe runs despite the SKU table
  // carrying a blended ~55% markup. Wages still paid weekly.
  const newCash = biz.cash + hourRevenue;

  const updated: Business = {
    ...biz,
    cash: newCash,
    state: state as unknown as Record<string, unknown>,
    derived: {
      ...biz.derived,
      footTraffic: traffic,
      stockLevel: computeStockLevel(state),
      pendingWages: state.wagesAccrued,
      riskScore: Math.max(
        0,
        Math.min(
          100,
          40 - avgService * 40 + ctx.rng.nextFloat(-5, 5) * (activeStaff ? 1 : 2),
        ),
      ),
    },
  };

  return { business: updated, ledger: ledgerEntries, events };
}

/**
 * Daily: consider restocking from suppliers, roll morale.
 */
function onDay(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const ledgerEntries: LedgerEntry[] = [];
  let cash = biz.cash;

  // Restock below threshold. v0.10.1 balance pass: under cash pressure,
  // order whatever `cash` can afford instead of silently skipping the
  // restock. Previously a negative / tight-cash store watched its
  // shelves drain to zero, revenue collapse, and the player had no
  // warning — the classic retail death spiral. With partial restocks,
  // revenue decays gracefully and the loss signal is visible via
  // weekly-revenue KPI rather than hidden behind empty shelves.
  for (const skuId of Object.keys(state.skus) as SkuId[]) {
    const sku = state.skus[skuId]!;
    if (sku.stock < sku.restockThreshold) {
      const fullOrder = sku.restockBatch - sku.stock;
      const affordableUnits =
        cash >= sku.cost * fullOrder
          ? fullOrder
          : Math.max(0, Math.floor(cash / Math.max(1, sku.cost)));
      if (affordableUnits <= 0) continue;
      const cost = sku.cost * affordableUnits;
      sku.stock += affordableUnits;
      cash -= cost;
      ledgerEntries.push(
        ledger(
          `restock-${biz.id}-${skuId}-${ctx.tick}`,
          ctx.tick,
          -cost,
          "inventory_purchase",
          affordableUnits < fullOrder
            ? `Partial restock ${skuId} (${affordableUnits}/${fullOrder} units)`
            : `Restock ${skuId} (${affordableUnits} units)`,
          biz.id,
        ),
      );
    }
  }

  // Morale random walk.
  for (const s of state.staff) {
    s.morale = Math.max(
      0,
      Math.min(100, s.morale + ctx.rng.nextFloat(-3, 2.5)),
    );
    s.skill = Math.min(100, s.skill + ctx.rng.nextFloat(0, 0.2));
  }

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

/**
 * Weekly: pay wages, pay rent (quarter-monthly), marketing, book profit.
 */
function onWeek(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const ledgerEntries: LedgerEntry[] = [];
  let cash = biz.cash;

  // Pay accumulated wages.
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

  // Rent: monthly / (HOURS_PER_WEEK) style — just charge 1/4 monthly weekly.
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

  // Marketing spend: v0.10 sums across all six channels. The per-channel
  // decay/lift runs hourly in `tickLevers` (engine/tick.ts) — this block
  // just debits cash + records the ledger entry.
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

  // Compute weekly KPIs.
  const weeklyRevenue = state.weeklyRevenueAcc;
  const weeklyExpenses =
    state.weeklyCogsAcc + state.wagesAccrued + weeklyRent + weeklyMarketing;
  const weeklyProfitPretax = weeklyRevenue - weeklyExpenses;

  // Corporate tax on positive profit.
  const tax = corporateTax(weeklyProfitPretax);
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

  const weeklyProfit = weeklyProfitPretax - tax;

  // v0.8.1: compute weekly traffic/conversion KPIs BEFORE resetting.
  const weeklyVisitors = Math.round(state.weeklyVisitorsAcc ?? 0);
  const weeklyUnitsSold = Math.round(state.weeklyUnitsSoldAcc ?? 0);
  const weeklyConversion =
    weeklyVisitors > 0 ? weeklyUnitsSold / weeklyVisitors : 0;

  // Reset weekly counters.
  state.weeklyRevenueAcc = 0;
  state.weeklyCogsAcc = 0;
  state.wagesAccrued = 0;
  state.weeklyVisitorsAcc = 0;
  state.weeklyUnitsSoldAcc = 0;

  // v0.10 lever CSAT contributions:
  //   · hours:    +1/+2 for 140+/168 hr weeks
  //   · promo:    negative while active (deep discounts erode brand), small
  //               positive "deal memory" for ~4 weeks after.
  const levers = leversOf(biz);
  const hoursBonus = hoursCsatBonus(levers.hours);
  const promoDelta = promotionCsatDelta(levers.promotion, ctx.tick);
  const kpis: BusinessKPIs = {
    ...biz.kpis,
    weeklyRevenue,
    weeklyExpenses,
    weeklyProfit,
    customerSatisfaction: Math.max(
      0,
      Math.min(
        100,
        biz.kpis.customerSatisfaction +
          (weeklyRevenue > weeklyExpenses ? 1 : -2) +
          hoursBonus +
          promoDelta +
          ctx.rng.nextFloat(-1, 1),
      ),
    ),
    weeklyVisitors,
    weeklyUnitsSold,
    weeklyConversion,
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
      weeklyProfit < -percentOf(weeklyRevenue || 1, 0.3)
        ? [
            {
              kind: "business_event",
              title: "Rough week",
              detail: `${biz.name} lost money this week.`,
            },
          ]
        : [],
  };
}

function updateDerived(biz: Business, state: CornerStoreState): Business {
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

export const cornerStoreModule: BusinessTypeModule = {
  id: "corner_store",
  ui,
  startup,
  create: createBusiness,
  onHour,
  onDay,
  onWeek,
};

// Expose the weekly cadence so the tick loop can call us when the week rolls.
export const CORNER_STORE_WEEK_HOURS = HOURS_PER_WEEK;
