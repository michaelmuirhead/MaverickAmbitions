/**
 * Shared parameterized retail engine.
 *
 * The corner store (retail.ts) is its own module because it's the
 * hardcoded MVP starter. This file is the GENERAL engine that every
 * other storefront retail category uses: bookstore, electronics,
 * florist, supermarket, jewelry, clothing, suit, furniture.
 *
 * Each category is a thin `BusinessTypeModule` that binds a
 * `RetailCategoryConfig` to this engine. The config controls:
 *   - Startup cost, unlock, and credit floor.
 *   - Storefront rent (a multiplier on base rent).
 *   - Ticket size (average price range) and gross-margin band.
 *   - Traffic intensity and price elasticity bias.
 *   - Distinctive touches per category:
 *       * florist — seasonal spike (Valentine's, Mother's Day) via
 *         a weekly multiplier lookup; heavy waste risk on perishables.
 *       * jewelry — theft-risk overlay and ticket-size skew.
 *       * furniture — slow ticket cadence, delivery fee channel.
 *       * supermarket — thin margins, high unit volume.
 *       * electronics — high ASP, heavy warranty/return exposure.
 *       * clothing / suit — seasonality + returns.
 *       * bookstore — event hook for author-event days.
 *
 * To add another retail category, write a new file in this folder that
 *   export const xModule = makeRetailModule({ ...config });
 * and register it.
 */

import type {
  Business,
  BusinessDerived,
  BusinessKPIs,
  BusinessTypeId,
  Cents,
  Id,
  LedgerEntry,
  Tick,
} from "@/types/game";

import { getHours, getMonth } from "date-fns";

import { isBusinessHour, isWeekend, tickToDate } from "@/lib/date";
import { dollars } from "@/lib/money";

import { ECONOMY } from "../economy/constants";
import { corporateTax, ledger } from "../economy/finance";
import { getPulseBundle } from "../macro/events";
import {
  competitiveDensity,
  marketFootTraffic,
  priceAttractiveness,
} from "../economy/market";

import type {
  BusinessStartupSpec,
  BusinessTickContext,
  BusinessTickResult,
  BusinessTypeModule,
  BusinessUiDescriptor,
} from "./types";

// ---------- Config ----------

export interface RetailSkuSpec {
  id: string;
  name: string;
  /** Per-unit wholesale cost. */
  cost: Cents;
  /** Per-unit retail price. */
  price: Cents;
  /** How many units are restocked when stock crosses the threshold. */
  restockBatch: number;
  /** A 0..1 weight biasing which SKUs sell more per hour. */
  popularity?: number;
}

export interface RetailCategoryConfig {
  /** Business-type id this config builds a module for. */
  id: BusinessTypeId;
  label: string;
  icon: string;
  startup: BusinessStartupSpec;
  /** Monthly rent = BASE_RENT_MONTHLY_CENTS × this multiplier. */
  rentMultiplier: number;
  /** Effective visit rate (base 0.06). Default 1.0 => 6% intent. */
  visitRateMul: number;
  /** Price elasticity override. 1 = normal; >1 = more elastic (price-sensitive). */
  elasticityBias?: number;
  /** Starter SKUs. */
  skus: RetailSkuSpec[];
  /** Label for the UI "stock level" KPI. */
  stockLabel?: string;
  /** Starting cash (cents). */
  startingCash: Cents;
  /** Starting staff count. */
  startingStaffCount: number;
  /** Hourly wage multiplier for staff. Jewelry/suit ~1.25, supermarket ~0.9. */
  wageMultiplier?: number;
  /** Startup marketing weekly (cents). */
  marketingWeekly: Cents;

  // Distinctive per-category overlays
  /** Monthly demand multipliers, 1..12 (Jan..Dec). 1.0 is neutral. */
  seasonality?: number[];
  /** Chance per operating hour of a theft/shrinkage loss (0..1). */
  theftChancePerHour?: number;
  /** Average theft loss (cents) when triggered. */
  avgTheftLoss?: Cents;
  /** Whether perishables — unsold stock wastes at onDay. */
  perishable?: boolean;
  /** Fraction of sold revenue that gets returned (0..1). */
  returnRate?: number;
  /** Optional weekly special event that bumps traffic (e.g., bookstore author night). */
  weeklyEventTrafficBump?: number;
}

export interface GenericRetailSku {
  id: string;
  name: string;
  cost: Cents;
  price: Cents;
  referencePrice: Cents;
  stock: number;
  restockThreshold: number;
  restockBatch: number;
  popularity: number;
}

export interface GenericRetailStaff {
  id: Id;
  name: string;
  hourlyWageCents: Cents;
  skill: number;
  morale: number;
}

export interface GenericRetailState {
  skus: Record<string, GenericRetailSku>;
  staff: GenericRetailStaff[];
  locationQuality: number;
  marketingScore: number;
  rentMonthly: Cents;
  marketingWeekly: Cents;
  weeklyRevenueAcc: Cents;
  weeklyCogsAcc: Cents;
  weeklyReturnsAcc: Cents;
  weeklyShrinkageAcc: Cents;
  wagesAccrued: Cents;
  /** Perishable waste tracked weekly for CSAT nudges. */
  weeklyWasteUnits: number;
  /** v0.8.1: Estimated visitors accumulated across the week. */
  weeklyVisitorsAcc?: number;
  /** v0.8.1: Units sold accumulated across the week (sum across SKUs). */
  weeklyUnitsSoldAcc?: number;
}

function monthIndex(tick: Tick): number {
  return getMonth(tickToDate(tick)); // 0..11
}

function hourOf(tick: Tick): number {
  return getHours(tickToDate(tick));
}

export function makeRetailModule(
  config: RetailCategoryConfig,
): BusinessTypeModule {
  const ui: BusinessUiDescriptor = {
    label: config.label,
    icon: config.icon,
    kpiLabels: [
      "Weekly Revenue",
      "Weekly Profit",
      config.stockLabel ?? "Stock Level",
      "Customer Satisfaction",
    ],
    sections: ["inventory", "staff", "pricing", "marketing"],
  };

  function create(params: {
    id: Id;
    ownerId: Id;
    name: string;
    locationId: Id;
    tick: Tick;
    seed: string;
  }): Business {
    const skus: Record<string, GenericRetailSku> = {};
    for (const s of config.skus) {
      const initialStock = s.restockBatch;
      skus[s.id] = {
        id: s.id,
        name: s.name,
        cost: s.cost,
        price: s.price,
        referencePrice: s.price,
        stock: initialStock,
        restockThreshold: Math.floor(initialStock * 0.25),
        restockBatch: s.restockBatch,
        popularity: s.popularity ?? 1,
      };
    }
    const staff: GenericRetailStaff[] = [];
    const wageMul = config.wageMultiplier ?? 1;
    for (let i = 0; i < config.startingStaffCount; i++) {
      staff.push({
        id: `${params.id}-clerk-${i + 1}`,
        name: `Clerk ${i === 0 ? "Alpha" : `Staff ${i + 1}`}`,
        hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * wageMul),
        skill: 45 + (i === 0 ? 5 : 0),
        morale: 70,
      });
    }

    const state: GenericRetailState = {
      skus,
      staff,
      locationQuality: 0.55,
      marketingScore: 0.2,
      rentMonthly: Math.round(
        ECONOMY.BASE_RENT_MONTHLY_CENTS * config.rentMultiplier,
      ),
      marketingWeekly: config.marketingWeekly,
      weeklyRevenueAcc: 0,
      weeklyCogsAcc: 0,
      weeklyReturnsAcc: 0,
      weeklyShrinkageAcc: 0,
      wagesAccrued: 0,
      weeklyWasteUnits: 0,
      weeklyVisitorsAcc: 0,
      weeklyUnitsSoldAcc: 0,
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
      riskScore: 10,
    };

    return {
      id: params.id,
      ownerId: params.ownerId,
      type: config.id,
      name: params.name,
      locationId: params.locationId,
      openedAtTick: params.tick,
      cash: config.startingCash,
      state: state as unknown as Record<string, unknown>,
      kpis,
      derived,
    };
  }

  function getState(biz: Business): GenericRetailState {
    return structuredClone(biz.state) as unknown as GenericRetailState;
  }

  function computeStockLevel(state: GenericRetailState): number {
    const values = Object.values(state.skus);
    if (values.length === 0) return 0;
    let pct = 0;
    for (const s of values) {
      pct += Math.min(1, s.stock / Math.max(1, s.restockBatch));
    }
    return pct / values.length;
  }

  function competitorsInMarket(
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

  function avgService(state: GenericRetailState): number {
    if (state.staff.length === 0) return 0;
    return (
      state.staff.reduce((a, s) => a + (s.skill * s.morale) / 10000, 0) /
      state.staff.length
    );
  }

  function onHour(
    biz: Business,
    ctx: BusinessTickContext,
  ): BusinessTickResult {
    const state = getState(biz);
    const market = ctx.world.markets[biz.locationId];
    const ledgerEntries: LedgerEntry[] = [];
    const events: BusinessTickResult["events"] = [];

    if (!market || !isBusinessHour(ctx.tick) || state.staff.length === 0) {
      return {
        business: updateDerivedOnly(biz, state),
        ledger: [],
        events: [],
      };
    }

    const pulse = getPulseBundle(ctx.world.activeEvents ?? []);

    // Seasonality multiplier.
    const season = config.seasonality?.[monthIndex(ctx.tick)] ?? 1;

    const baseTraffic =
      marketFootTraffic(market, ctx.macro, ctx.tick) * season;
    const density = competitiveDensity(competitorsInMarket(ctx.world, biz));
    const service = avgService(state);

    const visitRate =
      ECONOMY.BASE_VISIT_RATE *
      config.visitRateMul *
      (0.5 + state.marketingScore) *
      (0.5 + state.locationQuality) /
      density;

    // Weekend nudge for consumer-retail categories (non-grocery).
    const weekendMul =
      !config.perishable && isWeekend(ctx.tick) ? 1.2 : 1.0;

    let hourRevenue = 0;
    let hourCogs = 0;
    let unitsSoldTotal = 0;

    const elasticityBias = config.elasticityBias ?? 1;
    for (const skuId of Object.keys(state.skus)) {
      const sku = state.skus[skuId]!;
      if (sku.stock <= 0) continue;

      const priceRatio = sku.price / Math.max(1, sku.referencePrice);
      const pa = priceAttractiveness(priceRatio);
      // Push elasticity around 1.0 via the bias.
      const priceMod =
        elasticityBias === 1 ? pa : Math.pow(pa, elasticityBias);

      const conversion = ECONOMY.BASE_CONVERSION * priceMod * (0.6 + service);
      const expected =
        baseTraffic *
        visitRate *
        conversion *
        weekendMul *
        sku.popularity *
        0.04;
      const unitsSold = Math.min(
        sku.stock,
        Math.max(0, Math.round(expected + ctx.rng.nextFloat(-1, 1))),
      );

      if (unitsSold > 0) {
        sku.stock -= unitsSold;
        const rev = sku.price * unitsSold;
        const cogs = Math.round(sku.cost * unitsSold * pulse.cogsMultiplier);
        hourRevenue += rev;
        hourCogs += cogs;
        unitsSoldTotal += unitsSold;
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

    // Returns channel: reverse a small fraction.
    let returnsThisHour = 0;
    if (config.returnRate && config.returnRate > 0 && hourRevenue > 0) {
      returnsThisHour = Math.round(hourRevenue * config.returnRate);
      state.weeklyReturnsAcc += returnsThisHour;
      ledgerEntries.push(
        ledger(
          `rtn-${biz.id}-${ctx.tick}`,
          ctx.tick,
          -returnsThisHour,
          "revenue",
          "Customer returns",
          biz.id,
        ),
      );
    }

    // Theft / shrinkage roll — jewelry + electronics bite hardest.
    let shrinkageThisHour = 0;
    if (
      config.theftChancePerHour &&
      hourOf(ctx.tick) >= 8 &&
      hourOf(ctx.tick) <= 22 &&
      ctx.rng.chance(config.theftChancePerHour)
    ) {
      const loss = Math.round(
        (config.avgTheftLoss ?? dollars(200)) *
          (0.5 + ctx.rng.next() * 1.5),
      );
      shrinkageThisHour = loss;
      state.weeklyShrinkageAcc += loss;
      ledgerEntries.push(
        ledger(
          `shrink-${biz.id}-${ctx.tick}`,
          ctx.tick,
          -loss,
          "cogs",
          "Shrinkage / theft",
          biz.id,
        ),
      );
      events.push({
        kind: "business_event",
        title: `Shoplifting at ${biz.name}`,
        detail: "Inventory walked out the door this hour.",
      });
    }

    // Accrue wages.
    const wagesThisHour = state.staff.reduce(
      (a, s) => a + s.hourlyWageCents,
      0,
    );
    state.wagesAccrued += wagesThisHour;

    state.weeklyRevenueAcc += hourRevenue - returnsThisHour;
    state.weeklyCogsAcc += hourCogs;

    // v0.8.1: accumulate estimated visitors + units sold so the weekly KPIs
    // can report traffic, conversion, and revenue-per-visitor. visitorsThisHour
    // is the realized foot traffic × visit intent rate — matches the same
    // numerator the SKU loop uses to compute per-SKU expected units.
    const visitorsThisHour = baseTraffic * visitRate * weekendMul;
    state.weeklyVisitorsAcc = (state.weeklyVisitorsAcc ?? 0) + visitorsThisHour;
    state.weeklyUnitsSoldAcc =
      (state.weeklyUnitsSoldAcc ?? 0) + unitsSoldTotal;

    const newCash =
      biz.cash + hourRevenue - hourCogs - returnsThisHour - shrinkageThisHour;

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
            25 +
              (config.theftChancePerHour ? 20 : 0) -
              service * 20 +
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

    // Perishable waste before restock — florists/grocers throw out unsold stock daily.
    if (config.perishable) {
      for (const id of Object.keys(state.skus)) {
        const sku = state.skus[id]!;
        const waste = Math.max(0, Math.floor(sku.stock * 0.25));
        if (waste > 0) {
          sku.stock -= waste;
          state.weeklyWasteUnits += waste;
        }
      }
    }

    // Restock below threshold.
    for (const id of Object.keys(state.skus)) {
      const sku = state.skus[id]!;
      if (sku.stock < sku.restockThreshold) {
        const order = sku.restockBatch - sku.stock;
        const cost = sku.cost * order;
        if (cash >= cost) {
          sku.stock += order;
          cash -= cost;
          ledgerEntries.push(
            ledger(
              `restock-${biz.id}-${id}-${ctx.tick}`,
              ctx.tick,
              -cost,
              "inventory_purchase",
              `Restock ${sku.name}`,
              biz.id,
            ),
          );
        }
      }
    }

    // Staff drift.
    for (const s of state.staff) {
      s.morale = Math.max(0, Math.min(100, s.morale + ctx.rng.nextFloat(-3, 2.5)));
      s.skill = Math.min(100, s.skill + ctx.rng.nextFloat(0, 0.2));
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
          "Weekly marketing",
          biz.id,
        ),
      );
      state.marketingScore = Math.min(
        1,
        state.marketingScore * 0.6 +
          Math.min(1, state.marketingWeekly / dollars(500)) * 0.4,
      );
    } else {
      state.marketingScore *= 0.6;
    }

    // Weekly event bump (bookstore author nights etc.) is a marketing-equivalent boost.
    if (config.weeklyEventTrafficBump && config.weeklyEventTrafficBump > 0) {
      state.marketingScore = Math.min(
        1,
        state.marketingScore + config.weeklyEventTrafficBump,
      );
    }

    const weeklyRevenue = state.weeklyRevenueAcc;
    const weeklyExpenses =
      state.weeklyCogsAcc +
      state.wagesAccrued +
      weeklyRent +
      state.marketingWeekly +
      state.weeklyShrinkageAcc;
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

    // CSAT: service + stock + waste penalty.
    const stock = computeStockLevel(state);
    const service = avgService(state);
    const wastePenalty = Math.min(10, state.weeklyWasteUnits / 10);
    const target =
      55 +
      service * 25 +
      stock * 10 +
      state.marketingScore * 5 -
      wastePenalty;
    const next =
      biz.kpis.customerSatisfaction +
      (Math.max(0, Math.min(92, target)) - biz.kpis.customerSatisfaction) *
        0.15;

    // v0.8.1: compute weekly traffic + conversion KPIs BEFORE resetting.
    const weeklyVisitors = Math.round(state.weeklyVisitorsAcc ?? 0);
    const weeklyUnitsSold = Math.round(state.weeklyUnitsSoldAcc ?? 0);
    const weeklyConversion =
      weeklyVisitors > 0 ? weeklyUnitsSold / weeklyVisitors : 0;

    // Reset weekly counters.
    state.weeklyRevenueAcc = 0;
    state.weeklyCogsAcc = 0;
    state.weeklyReturnsAcc = 0;
    state.weeklyShrinkageAcc = 0;
    state.wagesAccrued = 0;
    state.weeklyWasteUnits = 0;
    state.weeklyVisitorsAcc = 0;
    state.weeklyUnitsSoldAcc = 0;

    const kpis: BusinessKPIs = {
      ...biz.kpis,
      weeklyRevenue,
      weeklyExpenses,
      weeklyProfit,
      customerSatisfaction: next,
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
        derived: { ...biz.derived, pendingWages: 0 },
      },
      ledger: ledgerEntries,
      events: [],
    };
  }

  function updateDerivedOnly(
    biz: Business,
    state: GenericRetailState,
  ): Business {
    return {
      ...biz,
      derived: {
        ...biz.derived,
        stockLevel: computeStockLevel(state),
        pendingWages: state.wagesAccrued,
      },
    };
  }

  return {
    id: config.id,
    ui,
    startup: config.startup,
    create,
    onHour,
    onDay,
    onWeek,
  };
}
