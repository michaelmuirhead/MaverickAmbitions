/**
 * Market-level simulation helpers. Used by any customer-facing business.
 */

import type { MacroState, Market, Tick } from "@/types/game";

import { isBusinessHour } from "@/lib/date";

import { ECONOMY } from "./constants";

/**
 * Effective foot traffic for a market at a given tick.
 * Diurnal pattern, weekend bump, macro wallet modifier, desirability.
 *
 * v0.10.1 balance pass: the desirability curve was widened from
 * `0.5 + 0.5d` (0.50×…1.00× range) to `0.35 + 0.85d` (0.35×…1.20× range)
 * so picking a strong neighborhood actually rewards the player. Before
 * the change, the best and worst markets only differed ~50% on this
 * factor; after it's ~3.4× end-to-end.
 *
 * v0.10.1 second pass: population used to be a linear `pop / 10_000`
 * which meant a 68k-person dense market (Midtown) generated ~6× the
 * traffic of an 11.5k-person high-end market (Pine Ridge). Combined
 * with a flat desirability factor, that made highest-desirability
 * markets economically ~uncompetitive vs dense but mediocre ones.
 * Replaced with a sqrt-dampened curve so density still wins, just by
 * a much smaller margin (~1.5× instead of ~6× end-to-end).
 */
export function marketFootTraffic(
  market: Market,
  macro: MacroState,
  tick: Tick,
): number {
  if (!isBusinessHour(tick)) return 0;
  // sqrt-dampened population factor. Reference = 20k residents → 1.2×.
  // 10k → 1.05, 30k → 1.31, 70k → 1.63. Dense markets still win, but
  // only by ~1.6× end-to-end vs ~6× under the old linear formula.
  const populationFactor =
    0.7 + 0.5 * Math.sqrt(Math.max(0, market.population) / 20_000);
  const desirability = 0.35 + market.desirability * 0.85;
  const macroMultiplier = macro.consumerWallet;
  return Math.round(
    ECONOMY.BASE_HOURLY_TRAFFIC *
      populationFactor *
      desirability *
      macroMultiplier,
  );
}

/**
 * Per-visit spend multiplier based on a neighborhood's median income.
 * Wealthier neighborhoods buy pricier baskets; poorer ones penny-pinch.
 * Reference income is $60k → 1.0×. Dampened so extremes don't run away:
 * $30k → ~0.85×, $60k → 1.0×, $96k → ~1.13×, $120k → ~1.21×.
 * Applied multiplicatively to hourly revenue in the retail module —
 * keeps high-desirability-small-population markets genuinely
 * competitive with dense middle markets.
 */
export function marketBasketMultiplier(market: Market): number {
  const REFERENCE_INCOME_CENTS = 60_000 * 100; // $60k
  const ratio =
    (market.medianIncome ?? REFERENCE_INCOME_CENTS) / REFERENCE_INCOME_CENTS;
  return 0.6 + 0.4 * Math.sqrt(Math.max(0, ratio));
}

/**
 * How crowded the market is with competitors (player + rival stores in
 * the same category). 1 = only business present, >1 = crowded.
 */
export function competitiveDensity(competitorCount: number): number {
  return 1 + competitorCount * 0.35;
}

/**
 * Price attractiveness: a simple elasticity around a reference price.
 * Returns a 0..1.5 multiplier on conversion.
 * priceRatio = actualPrice / referencePrice
 *   0.8  -> 1.3 (cheap, converts well)
 *   1.0  -> 1.0
 *   1.2  -> 0.65
 *   1.5  -> 0.25
 */
export function priceAttractiveness(priceRatio: number): number {
  // Piecewise linear, clamped.
  if (priceRatio <= 0.6) return 1.5;
  if (priceRatio <= 1.0) return 1.5 - (priceRatio - 0.6) * 1.25;
  if (priceRatio <= 1.6) return Math.max(0.2, 1.0 - (priceRatio - 1.0) * 1.25);
  return 0.2;
}
