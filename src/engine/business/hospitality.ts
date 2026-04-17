/**
 * Shared hospitality primitives for bars and restaurants.
 *
 * Cafes already exist; they operate on a flywheel (CSAT → repeat visits
 * → halo). Bars and restaurants share three extra mechanics that cafes
 * don't need:
 *
 *   1. Tips — a fraction of revenue is paid out to tipped staff weekly.
 *      This reduces required wage floor and gently boosts morale.
 *   2. Peak hours — demand is not flat; bars peak late, restaurants peak
 *      at dinner. The demand curve is a multiplier on base foot traffic.
 *   3. Liquor licensing — a monthly fee + a compliance risk that spikes
 *      if the business is dirty (low CSAT / over-occupancy).
 *
 * These helpers are pure functions. The module calls them; they don't
 * reach into GameState themselves.
 */
import { getHours } from "date-fns";

import type { Cents, Tick } from "@/types/game";

import { dollars } from "@/lib/money";
import { tickToDate } from "@/lib/date";

// ---------- Tip pool ----------

/** Fraction of revenue paid out as tips at dining/drinking establishments. */
export const TIP_RATE = 0.15;

/**
 * Compute the tip pool for a period of revenue. Tips flow OUT of revenue
 * before profit — they are not an employer cost, but they don't count
 * toward gross profit either. Modules book a `tips` ledger entry so the
 * player can see where the money went.
 */
export function tipPool(revenueCents: Cents, rate: number = TIP_RATE): Cents {
  return Math.max(0, Math.round(revenueCents * rate));
}

// ---------- Peak hour curves ----------

/**
 * Bar peak curve. Closed mornings/lunch; warm evening ramp with a late
 * peak around 10pm–12am. Returned multiplier is applied to `marketFootTraffic`
 * and can drive traffic above/below the cafe baseline at the same market.
 */
export function barPeakMultiplier(tick: Tick): number {
  const h = getHours(tickToDate(tick));
  if (h < 16) return 0; // closed before 4pm
  if (h < 18) return 0.6; // early open, trickle
  if (h < 20) return 1.1; // dinner/happy-hour overlap
  if (h < 22) return 1.5; // prime
  if (h < 24) return 1.8; // late peak
  if (h < 2) return 1.4; // last call
  return 0; // 2am cutoff
}

/**
 * Restaurant peak curve. Double-peaked (lunch + dinner). Closed late.
 */
export function restaurantPeakMultiplier(tick: Tick): number {
  const h = getHours(tickToDate(tick));
  if (h < 11) return 0;
  if (h < 14) return 1.3; // lunch rush
  if (h < 17) return 0.5; // afternoon lull
  if (h < 19) return 1.5; // early dinner
  if (h < 21) return 1.7; // dinner peak
  if (h < 22) return 0.9; // tail
  return 0;
}

/** Bar/restaurant "is open at this tick?" check. Zero multiplier = closed. */
export function hospitalityIsOpen(kind: "bar" | "restaurant", tick: Tick): boolean {
  if (kind === "bar") return barPeakMultiplier(tick) > 0;
  return restaurantPeakMultiplier(tick) > 0;
}

// ---------- Happy hour ----------

/** A happy-hour window lowers prices and boosts conversion during a slow slot. */
export interface HappyHour {
  enabled: boolean;
  startHour: number; // inclusive
  endHour: number; // exclusive
  /** Discount applied to drink prices in the window (0..0.4). */
  discount: number;
  /** Conversion bump during the window (e.g. 0.3 = +30% visits). */
  trafficBump: number;
}

export const HAPPY_HOUR_DEFAULT: HappyHour = {
  enabled: false,
  startHour: 16,
  endHour: 19,
  discount: 0.25,
  trafficBump: 0.35,
};

export function inHappyHour(hh: HappyHour, tick: Tick): boolean {
  if (!hh.enabled) return false;
  const h = getHours(tickToDate(tick));
  return h >= hh.startHour && h < hh.endHour;
}

// ---------- Licensing ----------

/**
 * Liquor license monthly fee. Bars pay more than restaurants — the beer-
 * and-wine carve-out for full-service restaurants is standard.
 */
export function liquorLicenseMonthly(kind: "bar" | "restaurant"): Cents {
  if (kind === "bar") return dollars(750);
  return dollars(300);
}

/**
 * Compliance risk 0..100. A messy bar (low CSAT + over-occupancy +
 * late-night complaints) risks a citation that costs a fine and a
 * reputation ding. This is used by bar.ts to roll daily incidents.
 */
export function complianceRiskScore(inputs: {
  csat: number;
  occupancyRatio: number; // actual / licensed capacity
  noiseComplaintsThisWeek: number;
  idCheckDiligence: number; // 0..1, owner-set in UI
}): number {
  const csatPenalty = Math.max(0, (60 - inputs.csat)) * 0.8;
  const overOccupancy = Math.max(0, inputs.occupancyRatio - 1) * 40;
  const noise = Math.min(15, inputs.noiseComplaintsThisWeek * 3);
  const idSlack = (1 - inputs.idCheckDiligence) * 20;
  const raw = csatPenalty + overOccupancy + noise + idSlack;
  return Math.max(0, Math.min(100, raw));
}

// ---------- Liquor stocking tiers ----------

/** Three common shelf strategies. The player picks one; the sim keeps
 *  the choice in module state. This is the bar's equivalent of cafe
 *  quality tiers, with different cost/price/patron-mix tradeoffs. */
export type LiquorTier = "well" | "call" | "top_shelf";

export interface LiquorTierProfile {
  costMultiplier: number;
  priceMultiplier: number;
  /** CSAT ceiling contributed by the shelf alone. */
  csatCeiling: number;
  /** How much the tier attracts higher-tip patrons. */
  tipBoost: number;
}

export const LIQUOR_TIER: Record<LiquorTier, LiquorTierProfile> = {
  well:       { costMultiplier: 0.75, priceMultiplier: 0.85, csatCeiling: 72, tipBoost: 0 },
  call:       { costMultiplier: 1.0,  priceMultiplier: 1.0,  csatCeiling: 85, tipBoost: 0.02 },
  top_shelf:  { costMultiplier: 1.45, priceMultiplier: 1.55, csatCeiling: 94, tipBoost: 0.05 },
};

// ---------- Restaurant menu tiers ----------

/** Restaurant "menu program" — parallel to cafe quality tiers and bar
 *  liquor tiers. Drives cost, price, CSAT ceiling, and table-turn time. */
export type MenuProgram = "diner" | "bistro" | "chef_driven";

export interface MenuProgramProfile {
  costMultiplier: number;
  priceMultiplier: number;
  csatCeiling: number;
  /** Base minutes per table turn; complexity slows throughput. */
  turnMinutes: number;
  /** How much the program attracts higher-tip patrons. */
  tipBoost: number;
}

export const MENU_PROGRAM: Record<MenuProgram, MenuProgramProfile> = {
  diner:        { costMultiplier: 0.8,  priceMultiplier: 0.9,  csatCeiling: 75, turnMinutes: 45, tipBoost: 0 },
  bistro:       { costMultiplier: 1.0,  priceMultiplier: 1.1,  csatCeiling: 88, turnMinutes: 70, tipBoost: 0.03 },
  chef_driven:  { costMultiplier: 1.4,  priceMultiplier: 1.6,  csatCeiling: 95, turnMinutes: 95, tipBoost: 0.06 },
};
