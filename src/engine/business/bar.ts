/**
 * Bar / drinking-establishment business module.
 *
 * Shares the hospitality flywheel with cafes (CSAT → repeat visits →
 * halo) but differs in three concrete ways:
 *
 *   1. Peak hours are LATE — closed before 4pm, prime 10pm–12am. See
 *      hospitality.barPeakMultiplier().
 *   2. Happy hour is an owner-set knob: discount + traffic bump during a
 *      slow slot (default 4–7pm). Happy hour lifts volume and wallet
 *      share, at the cost of margin during the window.
 *   3. Liquor shelf tier (well / call / top_shelf) is the dominant
 *      quality lever — like cafe quality tier but with a different
 *      patron-mix and tip ceiling.
 *
 * A slice of revenue is paid out as tips each week. The `tips` ledger
 * category tells the player where that went. Bartender wages sit below
 * ambient retail — tipped staff earn their income off the float.
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
import { BAR_DRINKS, type DrinkId } from "@/data/barDrinks";
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

import {
  HAPPY_HOUR_DEFAULT,
  LIQUOR_TIER,
  type HappyHour,
  type LiquorTier,
  barPeakMultiplier,
  complianceRiskScore,
  hospitalityIsOpen,
  inHappyHour,
  liquorLicenseMonthly,
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

export interface BarState {
  menu: Record<DrinkId, BarMenuItem>;
  bartenders: Bartender[];
  liquorTier: LiquorTier;
  happyHour: HappyHour;

  /** Licensed fire-code capacity. Bar won't seat above it without risk. */
  licensedCapacity: number;
  /** 0..1 — how rigorously staff ID-checks; owner knob. */
  idCheckDiligence: number;
  /** 0..1 — location quality at open. */
  locationQuality: number;
  /** 0..1 — ambience (decays, refreshed via capex). */
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
  happyHourDiscountAcc: Cents;
  noiseComplaintsThisWeek: number;

  /** Rolling 4-week CSAT history. */
  csatHistory: number[];

  /** Monthly license tick-counter. */
  ticksSinceLicenseCharge: number;
}

export interface BarMenuItem {
  id: DrinkId;
  cost: Cents;
  price: Cents;
  referencePrice: Cents;
  popularity: number;
  prepSeconds: number;
  happyHourEligible: boolean;
}

export interface Bartender {
  id: Id;
  name: string;
  hourlyWageCents: Cents; // tipped wage — tips top this up
  /** 0..100 craft — faster pours, better house-cocktail accuracy. */
  craft: number;
  morale: number;
}

// ---------- UI / startup ----------

const ui: BusinessUiDescriptor = {
  label: "Bar",
  icon: "🍻",
  kpiLabels: [
    "Customer Satisfaction",
    "Weekly Profit",
    "Nightly Covers",
    "Tips Paid",
  ],
  sections: ["menu", "staff", "pricing", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(125_000),
  minimumCreditScore: 660,
  requiredSkills: { management: 20, negotiation: 10 },
  unlocksAt: { netWorthCents: dollars(100_000) },
};

// ---------- Factory ----------

function buildInitialMenu(tier: typeof LIQUOR_TIER[LiquorTier]): Record<DrinkId, BarMenuItem> {
  const out: Record<DrinkId, BarMenuItem> = {} as Record<DrinkId, BarMenuItem>;
  for (const drink of BAR_DRINKS) {
    const cost = Math.round(drink.baseCost * tier.costMultiplier);
    const price = Math.round(drink.basePrice * tier.priceMultiplier);
    out[drink.id] = {
      id: drink.id,
      cost,
      price,
      referencePrice: price,
      popularity: drink.popularity,
      prepSeconds: drink.prepSeconds,
      happyHourEligible: drink.happyHourEligible,
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
  const tierKey: LiquorTier = "call";
  const tier = LIQUOR_TIER[tierKey];

  const state: BarState = {
    menu: buildInitialMenu(tier),
    bartenders: [
      {
        id: `${params.id}-bt-1`,
        name: "Bartender Alpha",
        hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 0.55),
        craft: 58,
        morale: 70,
      },
      {
        id: `${params.id}-bt-2`,
        name: "Bartender Beta",
        hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 0.55),
        craft: 42,
        morale: 68,
      },
    ],
    liquorTier: tierKey,
    happyHour: { ...HAPPY_HOUR_DEFAULT },

    licensedCapacity: 90,
    idCheckDiligence: 0.7,
    locationQuality: 0.55,
    ambience: 0.7,
    lastAmbienceRefreshTick: params.tick,
    rentMonthly: Math.round(ECONOMY.BASE_RENT_MONTHLY_CENTS * 1.6),

    weeklyRevenueAcc: 0,
    weeklyCogsAcc: 0,
    weeklyCoversAcc: 0,
    wagesAccrued: 0,
    tipsAccrued: 0,
    happyHourDiscountAcc: 0,
    noiseComplaintsThisWeek: 0,

    csatHistory: [68],
    ticksSinceLicenseCharge: 0,
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
    type: "bar",
    name: params.name,
    locationId: params.locationId,
    openedAtTick: params.tick,
    cash: dollars(12_000),
    state: state as unknown as Record<string, unknown>,
    kpis,
    derived,
  };
}

// ---------- Simulation ----------

function getState(biz: Business): BarState {
  // Deep-clone so in-place mutations inside onHour/onDay/onWeek don't touch
  // the frozen input state. The cloned tree is packaged back into the
  // returned Business via `state: state as ...`, keeping the module pure
  // from stepTick's point of view.
  return structuredClone(biz.state) as unknown as BarState;
}

function avgBartenderService(state: BarState): number {
  if (state.bartenders.length === 0) return 0;
  return (
    state.bartenders.reduce((acc, b) => acc + (b.craft * b.morale) / 10000, 0) /
    state.bartenders.length
  );
}

function competitorBarsInMarket(
  world: BusinessTickContext["world"],
  biz: Business,
): number {
  const market = world.markets[biz.locationId];
  if (!market) return 0;
  let n = 0;
  for (const id of market.businessIds) {
    if (id === biz.id) continue;
    const b = world.businesses[id];
    if (b && b.type === "bar") n++;
  }
  return n;
}

/**
 * Hourly: pour drinks. Peak-hour curve gates demand hardest of any
 * business type in the game. Happy hour shifts the curve leftward by
 * dropping prices and bumping traffic during the window.
 */
function onHour(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const market = ctx.world.markets[biz.locationId];
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];

  // v0.10: hospitality check encodes the type-natural operating window
  // (~6pm-2am for bars). `isBusinessOpenNow` intersects with the player's
  // schedule — closing a day overrides even peak-hour demand.
  if (
    !market ||
    !hospitalityIsOpen("bar", ctx.tick) ||
    !isBusinessOpenNow(biz, ctx.tick) ||
    state.bartenders.length === 0
  ) {
    return {
      business: updateDerivedOnly(biz, state),
      ledger: [],
      events: [],
    };
  }

  const peak = barPeakMultiplier(ctx.tick);
  const hh = state.happyHour;
  const happy = inHappyHour(hh, ctx.tick);

  // v0.5 macro-shock pulse: read once per hour, apply to traffic + COGS.
  const pulse = getPulseBundle(ctx.world.activeEvents ?? []);
  const trafficMul = pulse.trafficMultiplierByType.bar ?? 1;

  // v0.10: active promotion lifts traffic (+up to 40%) and discounts prices
  // on top of happy hour.
  const promo = leversOf(biz).promotion;
  const promoDisc = currentPromoPctOff(promo, ctx.tick);
  const trafficLift = promotionTrafficLift(promo, ctx.tick);
  const baseTraffic =
    marketFootTraffic(market, ctx.macro, ctx.tick) * peak * trafficMul * trafficLift;
  const density = competitiveDensity(competitorBarsInMarket(ctx.world, biz));
  const service = avgBartenderService(state); // 0..1

  const ownHalo = hospitalityHalo(ctx.world, biz.ownerId, biz.locationId);
  const csatBoost = Math.max(0.7, biz.kpis.customerSatisfaction / 70);
  const ambienceBoost = 0.7 + state.ambience * 0.5;
  const happyBump = happy ? 1 + hh.trafficBump : 1;

  const marketingScore = effectiveMarketingScore(leversOf(biz), market);
  const visitRate =
    ECONOMY.BASE_VISIT_RATE *
    1.15 *
    (0.5 + marketingScore) *
    (0.6 + state.locationQuality) *
    csatBoost *
    (1 + ownHalo) *
    ambienceBoost *
    happyBump /
    density;

  // Throughput cap driven by bartender pour speed.
  const craftAvg =
    state.bartenders.reduce((a, b) => a + b.craft, 0) / state.bartenders.length;
  const prepEfficiency = 0.6 + (craftAvg / 100) * 0.8;
  const hourSeconds = 3600;
  const weightedPrepSec =
    Object.values(state.menu).reduce((a, m) => a + m.prepSeconds, 0) /
    Math.max(1, Object.keys(state.menu).length);
  const maxPoursPerBartenderHour =
    hourSeconds / Math.max(5, weightedPrepSec / prepEfficiency);
  const throughputCap = Math.round(
    maxPoursPerBartenderHour * state.bartenders.length,
  );

  let hourRevenue = 0;
  let hourCogs = 0;
  let hourDiscount = 0;
  let covers = 0;

  const weightTotal = Object.values(state.menu).reduce(
    (a, m) => a + m.popularity,
    0,
  );
  for (const drinkId of Object.keys(state.menu) as DrinkId[]) {
    if (covers >= throughputCap) break;
    const item = state.menu[drinkId]!;
    const share = item.popularity / Math.max(0.01, weightTotal);

    const happyPrice =
      happy && item.happyHourEligible
        ? Math.round(item.price * (1 - hh.discount))
        : item.price;
    // Stack: promo discount applies on top of happy-hour effective price.
    const effectivePrice = Math.max(1, Math.round(happyPrice * (1 - promoDisc)));
    const priceRatio = effectivePrice / Math.max(1, item.referencePrice);
    const priceMod = priceAttractiveness(priceRatio);

    const expected =
      baseTraffic * visitRate * share * (0.5 + service) * priceMod;
    const demand = Math.max(
      0,
      Math.round(expected + ctx.rng.nextFloat(-1, 1)),
    );
    const capRemaining = Math.max(0, throughputCap - covers);
    const sold = Math.min(demand, capRemaining);

    if (sold > 0) {
      const rev = effectivePrice * sold;
      const cogs = Math.round(item.cost * sold * pulse.cogsMultiplier);
      const discount = Math.max(0, item.price - effectivePrice) * sold;
      hourRevenue += rev;
      hourCogs += cogs;
      hourDiscount += discount;
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
        "Hourly pours",
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

  // Occupancy — used for compliance risk. Bars close at 2am; peak at 11pm.
  const occupancy = covers; // "people through the door this hour"
  if (occupancy > state.licensedCapacity * 0.9) {
    state.noiseComplaintsThisWeek += ctx.rng.nextFloat(0, 0.6);
  }

  // Tips pool (accrued; paid out weekly).
  const tipsThisHour = tipPool(hourRevenue, 0.15 + LIQUOR_TIER[state.liquorTier].tipBoost);
  state.tipsAccrued += tipsThisHour;

  // Wages accrue (tipped base). v0.10: graveyard hours (0-6, 22-23) pay
  // 1.25× — relevant for bar's natural late-night window.
  const wageMul = hourlyWageMultiplier(ctx.tick);
  const wagesThisHour = Math.round(
    state.bartenders.reduce((acc, b) => acc + b.hourlyWageCents, 0) * wageMul,
  );
  state.wagesAccrued += wagesThisHour;

  state.weeklyRevenueAcc += hourRevenue;
  state.weeklyCogsAcc += hourCogs;
  state.weeklyCoversAcc += covers;
  state.happyHourDiscountAcc += hourDiscount;

  const newCash = biz.cash + hourRevenue - hourCogs;

  const updated: Business = {
    ...biz,
    cash: newCash,
    state: state as unknown as Record<string, unknown>,
    derived: {
      ...biz.derived,
      footTraffic: baseTraffic,
      stockLevel: 1, // bars stock centrally; not a daily par
      pendingWages: state.wagesAccrued,
      riskScore: complianceRiskScore({
        csat: biz.kpis.customerSatisfaction,
        occupancyRatio: occupancy / Math.max(1, state.licensedCapacity),
        noiseComplaintsThisWeek: state.noiseComplaintsThisWeek,
        idCheckDiligence: state.idCheckDiligence,
      }),
    },
  };

  return { business: updated, ledger: ledgerEntries, events };
}

/**
 * Daily: morale walk, ambience decay, roll the compliance die, and
 * settle the CSAT flywheel.
 */
function onDay(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];
  let cash = biz.cash;

  // Morale drift — night shifts are hard.
  for (const b of state.bartenders) {
    b.morale = Math.max(0, Math.min(100, b.morale + ctx.rng.nextFloat(-4, 2)));
    b.craft = Math.min(100, b.craft + ctx.rng.nextFloat(0, 0.2));
  }

  // Ambience decay.
  state.ambience = Math.max(0.3, state.ambience - 0.002);

  // Compliance incident — a small daily roll.
  const risk = biz.derived.riskScore;
  const fireAt = 55 + ctx.rng.nextFloat(0, 25);
  if (risk >= fireAt) {
    const fine = dollars(1_000 + Math.floor((risk - fireAt) * 50));
    cash -= fine;
    ledgerEntries.push(
      ledger(
        `fine-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -fine,
        "other",
        "Compliance citation",
        biz.id,
      ),
    );
    events.push({
      kind: "business_event",
      title: `${biz.name} cited by inspectors`,
      detail: `A citation cost $${(fine / 100).toLocaleString()}. Tighten ID checks and reduce over-occupancy.`,
      impact: { cashDelta: -fine, reputationDelta: -1 },
    });
  }

  // --- Flywheel ---
  const tier = LIQUOR_TIER[state.liquorTier];
  const service = avgBartenderService(state);
  const avgPriceRatio =
    Object.values(state.menu).reduce(
      (a, m) => a + m.price / Math.max(1, m.referencePrice),
      0,
    ) / Math.max(1, Object.keys(state.menu).length);
  const priceFairness = priceAttractiveness(avgPriceRatio);

  const csatMarketingScore = effectiveMarketingScore(
    leversOf(biz),
    ctx.world.markets[biz.locationId],
  );
  // v0.10: 24/7 / late-night extended schedule adds a small convenience CSAT.
  const hoursBonus = hoursCsatBonus(leversOf(biz).hours);
  // v0.10: active promo bleeds CSAT; memory window gives a small post-promo bump.
  const promoDelta = promotionCsatDelta(leversOf(biz).promotion, ctx.tick);
  const target =
    50 +
    service * 30 +
    (state.ambience - 0.5) * 20 +
    (priceFairness - 1) * 8 +
    (csatMarketingScore - 0.3) * 5 +
    hoursBonus -
    state.noiseComplaintsThisWeek * 1.5;

  const ceiling = tier.csatCeiling;
  const clampedTarget = Math.max(0, Math.min(ceiling, target));
  const prev = biz.kpis.customerSatisfaction;
  // Daily pull + 1/7 of the weekly promo delta for smooth ramp.
  const next = prev + (clampedTarget - prev) * 0.13 + promoDelta / 7;

  if (prev < 85 && next >= 85) {
    events.push({
      kind: "milestone",
      title: `${biz.name} is the neighborhood spot`,
      detail: "CSAT crossed 85 — regulars are bringing friends.",
      impact: { reputationDelta: 1 },
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
 * Weekly: wages, rent, marketing, tips payout, license accrual, tax.
 * Every four weeks we also pay the liquor license.
 */
function onWeek(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const ledgerEntries: LedgerEntry[] = [];
  let cash = biz.cash;

  // Wages.
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

  // Tips payout — tipped staff receive the pool.
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
    // Morale boost.
    for (const b of state.bartenders) {
      b.morale = Math.min(100, b.morale + 2);
    }
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

  // v0.10: channelized marketing — sum across 6 sliders; per-channel
  // decay + lift run each hour in tickLevers().
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

  // License fee — pay monthly, so roughly every 4 weeks.
  state.ticksSinceLicenseCharge += 1;
  if (state.ticksSinceLicenseCharge >= 4) {
    // liquor_tax_hike event multiplies the fee via pulse bundle.
    const weeklyPulse = getPulseBundle(ctx.world.activeEvents ?? []);
    const fee = Math.round(
      liquorLicenseMonthly("bar") * weeklyPulse.liquorLicenseFeeMultiplier,
    );
    cash -= fee;
    ledgerEntries.push(
      ledger(
        `lic-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -fee,
        "license_fee",
        "Liquor license",
        biz.id,
      ),
    );
    state.ticksSinceLicenseCharge = 0;
  }

  // Ambience weekly decay.
  state.ambience = Math.max(0.3, state.ambience - 0.012);

  // Weekly KPIs. Note: revenue is GROSS; tips are not a cost but flow
  // out to staff rather than profit, so we subtract them from net.
  const weeklyRevenue = state.weeklyRevenueAcc;
  const weeklyExpenses =
    state.weeklyCogsAcc +
    state.wagesAccrued +
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
  state.happyHourDiscountAcc = 0;
  state.noiseComplaintsThisWeek = 0;

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
              title: `${biz.name} is bleeding`,
              detail:
                "Negative weekly profit with low CSAT — rethink the shelf, tighten marketing, or the bar will close.",
            },
          ]
        : [],
  };
}

function updateDerivedOnly(biz: Business, state: BarState): Business {
  return {
    ...biz,
    derived: {
      ...biz.derived,
      pendingWages: state.wagesAccrued,
    },
  };
}

// ---------- Module export ----------

export const barModule: BusinessTypeModule = {
  id: "bar",
  ui,
  startup,
  create: createBusiness,
  onHour,
  onDay,
  onWeek,
};
