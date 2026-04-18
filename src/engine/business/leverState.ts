/**
 * Shared sales-lever state machine (v0.10 "Marketing & Levers").
 *
 * Central, pure helpers for:
 *   - Constructing a default `LeverState` on business open
 *   - Ticking channel decay and signage decay each engine tick
 *   - Computing the demographic-weighted effective marketing score
 *     a market sees (weighted sum over channels)
 *   - Hours-of-operation reads (open-now? scheduled hours per week?)
 *   - Signage / loyalty / promotion knob application
 *
 * This file is the single source of truth for lever math. Business-type
 * modules call into it so that tuning a formula touches one place, not
 * eighteen.
 */

import type {
  Business,
  BusinessTypeId,
  Cents,
  DayHoursValue,
  DayOfWeek,
  HoursSchedule,
  LeverState,
  LoyaltyTier,
  Market,
  MarketingChannel,
  MarketingChannelMap,
  Promotion,
  SignageTier,
  Tick,
} from "@/types/game";

import { getHours } from "date-fns";

import { dayOfWeek, tickToDate } from "@/lib/date";

import {
  MARKETING_CHANNELS,
  MARKETING_CHANNEL_IDS,
  zeroChannelMap,
} from "@/data/marketingChannels";
import { getMarketDemographics } from "@/data/marketDemographics";

const HOURS_PER_DAY = 24;
const HOURS_PER_WEEK = 168;

// ========== Defaults / constructors ==========

/** Standard retail "9–9 everyday" schedule used as a default. */
export function defaultRetailHours(): HoursSchedule {
  const day: DayHoursValue = { open: 9, close: 21 };
  return {
    0: day,
    1: day,
    2: day,
    3: day,
    4: day,
    5: day,
    6: day,
  };
}

/** Common hospitality schedule — later close on Fri/Sat. */
export function defaultHospitalityHours(): HoursSchedule {
  const weekday: DayHoursValue = { open: 7, close: 22 };
  const weekend: DayHoursValue = { open: 8, close: 24 };
  return {
    0: { open: 8, close: 22 }, // Sun
    1: weekday,
    2: weekday,
    3: weekday,
    4: weekday,
    5: weekend,
    6: weekend,
  };
}

/** 24/7 schedule, used by hospital/clinic-type businesses. */
export function allHours(): HoursSchedule {
  return {
    0: "24h",
    1: "24h",
    2: "24h",
    3: "24h",
    4: "24h",
    5: "24h",
    6: "24h",
  };
}

/**
 * Map a `BusinessTypeId` to the appropriate default-hours kind. Used by
 * biz factories (`openBusiness`, rival AI, relocation probe) to seed
 * `Business.levers` consistently without each per-type module having to
 * hand-populate the same defaults.
 */
export function leverKindFor(
  type: BusinessTypeId | undefined,
): "retail" | "hospitality" | "alwaysOn" {
  switch (type) {
    case "cafe":
    case "bar":
    case "restaurant":
    case "food_truck":
    case "pizza_shop":
    case "nightclub":
    case "cinema":
      return "hospitality";
    case "hospital_clinic":
      return "alwaysOn";
    default:
      return "retail";
  }
}

export function defaultLeversForBusinessType(
  type: BusinessTypeId | undefined,
): LeverState {
  return createDefaultLeverState(leverKindFor(type));
}

export function createDefaultLeverState(
  kind: "retail" | "hospitality" | "alwaysOn" = "retail",
): LeverState {
  const hours =
    kind === "hospitality"
      ? defaultHospitalityHours()
      : kind === "alwaysOn"
        ? allHours()
        : defaultRetailHours();
  return {
    marketingByChannel: zeroChannelMap(0 as Cents),
    marketingScoreByChannel: zeroChannelMap(0),
    hours,
    signageTier: "none",
    signageQuality: 0,
    loyaltyTier: "none",
    repeatCustomerShare: 0.15, // tiny baseline even without a program
    promotion: null,
  };
}

// ========== Channel decay / effectiveness ==========

/**
 * Per-tick decay + linear lift, per-channel. Returns a fresh state object.
 *
 * Model:
 *   score_t = score_{t-1} * decayPerTick
 *            + liftRate(spend) * (1 - score_{t-1})
 *
 * where liftRate(spend) = liftAtHalfSaturation × min(1, spend / saturation) / 168
 * (168 ticks per week → weekly lift contributes evenly across ticks).
 *
 * This converges to a steady state determined by the spend level, and decays
 * exponentially when spend goes to zero.
 */
export function tickMarketingChannels(state: LeverState): LeverState {
  const nextScores: MarketingChannelMap<number> = zeroChannelMap(0);
  for (const ch of MARKETING_CHANNEL_IDS) {
    const profile = MARKETING_CHANNELS[ch];
    const spend = state.marketingByChannel[ch];
    const effectiveSpend =
      spend >= profile.minWeeklyCents ? spend : 0;
    const saturationRatio = Math.min(
      1,
      effectiveSpend / profile.saturationCentsPerWeek,
    );
    const perTickLift =
      (profile.liftAtHalfSaturation * saturationRatio) / HOURS_PER_WEEK;
    const prev = state.marketingScoreByChannel[ch];
    const decayed = prev * profile.decayPerTick;
    const next = Math.max(0, Math.min(1, decayed + perTickLift * (1 - decayed)));
    nextScores[ch] = next;
  }
  return { ...state, marketingScoreByChannel: nextScores };
}

/**
 * Demographic-weighted effective marketing score for a market.
 * Each channel's contribution = score × (1 + ageMatch × 0.5 + incomeMatch × 0.5)
 * where ageMatch = 1 - |channel.ageReach - market.ageSkew| / 2 ∈ [0,1].
 * Final effective score is the max over channels (the best-performing
 * channel for that audience), clamped to [0, 1].
 *
 * Rationale: averaging would dilute a well-matched single channel; max
 * captures the "best fit wins" intuition and keeps the same [0,1] range
 * that every tick formula already expects in place of the old
 * `marketingScore` scalar.
 */
export function effectiveMarketingScore(
  state: LeverState,
  market: Market,
): number {
  const demo = market.demographics ?? getMarketDemographics(market.id);
  let best = 0;
  for (const ch of MARKETING_CHANNEL_IDS) {
    const profile = MARKETING_CHANNELS[ch];
    const score = state.marketingScoreByChannel[ch];
    if (score <= 0) continue;
    const ageMatch = 1 - Math.abs(profile.ageReach - demo.ageSkew) / 2;
    const incomeMatch = 1 - Math.abs(profile.incomeReach - demo.incomeSkew) / 2;
    const fit = 0.5 + ageMatch * 0.25 + incomeMatch * 0.25;
    const weighted = score * fit;
    if (weighted > best) best = weighted;
  }
  return Math.max(0, Math.min(1, best));
}

/** Sum of weekly spend across all channels. */
export function totalWeeklyMarketing(state: LeverState): Cents {
  let total = 0;
  for (const ch of MARKETING_CHANNEL_IDS) {
    total += state.marketingByChannel[ch];
  }
  return total as Cents;
}

// ========== Hours of operation ==========

export function dayHoursToOpenHours(day: DayHoursValue): number {
  if (day === "closed") return 0;
  if (day === "24h") return 24;
  const span = day.close - day.open;
  return span > 0 ? span : 0;
}

/** Total open-hours per week for the schedule. */
export function scheduledHoursPerWeek(schedule: HoursSchedule): number {
  let total = 0;
  for (let d = 0 as DayOfWeek; d < 7; d = ((d + 1) as DayOfWeek)) {
    total += dayHoursToOpenHours(schedule[d]);
  }
  return total;
}

/**
 * Is the business open at the given (dayOfWeek, hour)?
 * Hour is an integer 0..23 (local). Used by engine tick to gate revenue.
 */
export function isOpenAt(
  schedule: HoursSchedule,
  dayOfWeek: DayOfWeek,
  hour: number,
): boolean {
  const day = schedule[dayOfWeek];
  if (day === "closed") return false;
  if (day === "24h") return true;
  return hour >= day.open && hour < day.close;
}

/** Graveyard-hour premium applies to hours 0-6 and 22-24 for labor costing. */
export function graveyardHoursPerWeek(schedule: HoursSchedule): number {
  let total = 0;
  for (let d = 0 as DayOfWeek; d < 7; d = ((d + 1) as DayOfWeek)) {
    const day = schedule[d];
    if (day === "closed") continue;
    if (day === "24h") {
      total += 8; // 0-6 (6hr) + 22-24 (2hr)
      continue;
    }
    if (day.open < 6) total += 6 - day.open;
    if (day.close > 22) total += day.close - 22;
  }
  return total;
}

/**
 * Labor-cost multiplier vs. a "full 9-to-9 seven days a week" reference
 * schedule. Fewer scheduled hours → lower labor cost. Graveyard hours
 * incur a 1.25× wage premium.
 */
export function laborHoursMultiplier(schedule: HoursSchedule): number {
  const ref = 7 * (21 - 9); // 84 hrs/week full retail reference
  const regular = scheduledHoursPerWeek(schedule);
  const graveyard = graveyardHoursPerWeek(schedule);
  const effective = regular + graveyard * 0.25; // graveyard premium on top
  return Math.max(0.1, effective / ref);
}

/** Small CSAT bump for 24/7 convenience (bounded). */
export function hoursCsatBonus(schedule: HoursSchedule): number {
  const total = scheduledHoursPerWeek(schedule);
  if (total >= HOURS_PER_WEEK) return 2; // fully 24/7
  if (total >= HOURS_PER_WEEK * 0.85) return 1; // 140+ hrs/week
  return 0;
}

/**
 * Convenience wrapper: "is the business's player-configured schedule open
 * right now?". Business modules call this to gate revenue + customer-facing
 * activity in their `onHour`. Uses `leversOf(biz)` so a missing levers
 * block (v7 save, or legacy test fixture) falls back to the retail default.
 */
export function isBusinessOpenNow(biz: Business, tick: Tick): boolean {
  const schedule = leversOf(biz).hours;
  const dow = (dayOfWeek(tick) as DayOfWeek);
  const hour = getHours(tickToDate(tick));
  return isOpenAt(schedule, dow, hour);
}

/** Graveyard hours (0-6 and 22-23) that carry a wage premium. */
export function isGraveyardHour(tick: Tick): boolean {
  const h = getHours(tickToDate(tick));
  return h < 6 || h >= 22;
}

/** Hourly wage multiplier for the tick — 1.25× on graveyard shifts, else 1. */
export function hourlyWageMultiplier(tick: Tick): number {
  return isGraveyardHour(tick) ? 1.25 : 1.0;
}

// ========== Signage ==========

export const SIGNAGE_PROFILES: Record<
  SignageTier,
  {
    label: string;
    capexCents: Cents;
    qualityBoost: number; // added to locationQuality
    weeklyDecay: number; // signageQuality *= (1 - weeklyDecay) / week
  }
> = {
  none: { label: "None", capexCents: 0 as Cents, qualityBoost: 0, weeklyDecay: 0 },
  banner: {
    label: "Banner",
    capexCents: 50_000 as Cents, // $500
    qualityBoost: 0.04,
    weeklyDecay: 0.005,
  },
  lit: {
    label: "Lit sign",
    capexCents: 400_000 as Cents, // $4,000
    qualityBoost: 0.08,
    weeklyDecay: 0.003,
  },
  digital: {
    label: "Digital marquee",
    capexCents: 2_200_000 as Cents, // $22,000
    qualityBoost: 0.15,
    weeklyDecay: 0.002,
  },
};

export function signageBoost(state: LeverState): number {
  const profile = SIGNAGE_PROFILES[state.signageTier];
  return profile.qualityBoost * state.signageQuality;
}

export function tickSignageDecay(state: LeverState): LeverState {
  if (state.signageTier === "none") return state;
  const profile = SIGNAGE_PROFILES[state.signageTier];
  const perTick = profile.weeklyDecay / HOURS_PER_WEEK;
  const nextQuality = Math.max(0, state.signageQuality - perTick);
  return { ...state, signageQuality: nextQuality };
}

// ========== Loyalty ==========

export const LOYALTY_PROFILES: Record<
  LoyaltyTier,
  {
    label: string;
    perTransactionDiscountPct: number;
    repeatCustomerLift: number;
    setupCostCents: Cents;
  }
> = {
  none: {
    label: "No program",
    perTransactionDiscountPct: 0,
    repeatCustomerLift: 0,
    setupCostCents: 0 as Cents,
  },
  basic: {
    label: "Basic rewards",
    perTransactionDiscountPct: 0.02,
    repeatCustomerLift: 0.08,
    setupCostCents: 100_000 as Cents, // $1,000
  },
  gold: {
    label: "Gold tier",
    perTransactionDiscountPct: 0.05,
    repeatCustomerLift: 0.18,
    setupCostCents: 500_000 as Cents, // $5,000
  },
};

// ========== Promotion ==========

export function isPromotionActive(promo: Promotion | null, tick: Tick): boolean {
  if (!promo) return false;
  return tick >= promo.startTick && tick < promo.endTick;
}

export function isPromotionMemoryActive(
  promo: Promotion | null,
  tick: Tick,
): boolean {
  if (!promo || !promo.memoryUntilTick) return false;
  return tick >= promo.endTick && tick < promo.memoryUntilTick;
}

/** Active promo % off (0..0.5), else 0. */
export function currentPromoPctOff(
  promo: Promotion | null,
  tick: Tick,
): number {
  return isPromotionActive(promo, tick) ? Math.min(0.5, Math.max(0, promo!.pctOff)) : 0;
}

/**
 * Foot-traffic lift multiplier from an active promotion. Returns 1.0 when no
 * promo is active. Capped at +40% even for deep discounts — a 50% off sale
 * pulls a lot of extra traffic but physical space and staffing still bind.
 *
 * Curve:
 *   0% off  → 1.00×
 *   10% off → 1.12×
 *   20% off → 1.25×
 *   30% off → 1.38×
 *   40% off → 1.40× (capped)
 */
export function promotionTrafficLift(
  promo: Promotion | null,
  tick: Tick,
): number {
  const disc = currentPromoPctOff(promo, tick);
  if (disc <= 0) return 1.0;
  return 1 + Math.min(0.4, disc * 1.25);
}

/**
 * Weekly CSAT delta from the promo lifecycle. Deep discounts during an active
 * promo signal "this place is cheap, not premium" and pull CSAT down. After
 * the promo ends, a small positive "deal memory" bump runs for ~4 weeks as
 * bargain-hunters remember the sale fondly.
 *
 *   Active:  -min(1.5, pctOff * 3)   → 20% off = -0.6/wk, 30% = -0.9, 50% caps at -1.5
 *   Memory:  +0.5/wk
 *   Else:     0
 */
export function promotionCsatDelta(
  promo: Promotion | null,
  tick: Tick,
): number {
  if (!promo) return 0;
  if (isPromotionActive(promo, tick)) {
    return -Math.min(1.5, Math.max(0, promo.pctOff) * 3);
  }
  if (isPromotionMemoryActive(promo, tick)) {
    return 0.5;
  }
  return 0;
}

// ========== Business-level convenience ==========

/** Safe LeverState accessor — falls back to retail defaults if missing. */
export function leversOf(biz: Business): LeverState {
  return biz.levers ?? createDefaultLeverState("retail");
}

/**
 * Per-tick update for the lever state of a business: decay channels, decay
 * signage, and retire an expired promotion (stamping memoryUntilTick).
 */
export function tickLevers(state: LeverState, tick: Tick): LeverState {
  let next = tickMarketingChannels(state);
  next = tickSignageDecay(next);
  // Retire promo: if active window has just ended, stamp memoryUntilTick
  // so a post-promo CSAT bump plays out for ~4 weeks.
  if (next.promotion && tick >= next.promotion.endTick) {
    if (!next.promotion.memoryUntilTick) {
      next = {
        ...next,
        promotion: {
          ...next.promotion,
          memoryUntilTick: tick + HOURS_PER_WEEK * 4,
        },
      };
    } else if (tick >= next.promotion.memoryUntilTick) {
      // Memory has expired — clear the promotion entirely.
      next = { ...next, promotion: null };
    }
  }
  // Gentle repeat-customer-share drift toward the loyalty tier's target.
  const targetShare =
    0.15 + LOYALTY_PROFILES[next.loyaltyTier].repeatCustomerLift;
  if (Math.abs(next.repeatCustomerShare - targetShare) > 0.001) {
    const step = (targetShare - next.repeatCustomerShare) / (HOURS_PER_WEEK * 2);
    next = { ...next, repeatCustomerShare: next.repeatCustomerShare + step };
  }
  return next;
}

export const LEVER_CONSTANTS = {
  HOURS_PER_WEEK,
  HOURS_PER_DAY,
};

// Re-export for callers that want `MarketingChannel` without a direct type import.
export type { MarketingChannel };
