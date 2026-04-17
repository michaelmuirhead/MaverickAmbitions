/**
 * Hospitality reputation halo — the CSAT flywheel.
 *
 * A high-CSAT hospitality business doesn't just earn more at that
 * storefront; it radiates a reputation bonus across the owner's OTHER
 * businesses in the same neighborhood. That's what makes the Reputation
 * stat matter and what differentiates hospitality (cafe / bar /
 * restaurant) from corner stores mechanically.
 *
 * Design:
 *   - v0.2: only `cafe` contributed.
 *   - v0.4: `bar` and `restaurant` also contribute. Each has a slightly
 *     different per-storefront cap to reflect how broadly their
 *     reputation actually travels — restaurants get the biggest ding
 *     per unit of CSAT, bars the smallest (they tend to draw a narrower
 *     crowd).
 *   - Contribution per biz: linearly mapped from CSAT 60..95 → 0..cap.
 *   - Market halo = sum of contributions, capped at TOTAL_CAP (+30% traffic).
 *   - A rival owner's hospitality doesn't help other rivals' businesses
 *     — halo is per-owner, per-market.
 */

import type { BusinessTypeId, GameState, Id } from "@/types/game";

const MIN_CSAT = 60;
const MAX_CSAT = 95;
const TOTAL_CAP = 0.3;

const PER_BIZ_CAP: Partial<Record<BusinessTypeId, number>> = {
  cafe: 0.15,
  bar: 0.11,
  restaurant: 0.17,
};

function contributionCapFor(type: BusinessTypeId): number {
  return PER_BIZ_CAP[type] ?? 0;
}

/**
 * Compute the reputation halo multiplier contributed by `ownerId`'s
 * hospitality businesses in `marketId`. Result is added to traffic
 * multipliers in that market for businesses owned by the same entity.
 */
export function hospitalityHalo(
  state: GameState,
  ownerId: Id,
  marketId: Id,
): number {
  const market = state.markets[marketId];
  if (!market) return 0;

  let halo = 0;
  for (const bizId of market.businessIds) {
    const biz = state.businesses[bizId];
    if (!biz) continue;
    if (biz.ownerId !== ownerId) continue;
    const cap = contributionCapFor(biz.type);
    if (cap <= 0) continue;
    const csat = biz.kpis.customerSatisfaction;
    if (csat <= MIN_CSAT) continue;
    const normalized = Math.min(1, (csat - MIN_CSAT) / (MAX_CSAT - MIN_CSAT));
    halo += normalized * cap;
  }
  return Math.min(TOTAL_CAP, halo);
}

/** Peek: what would `csat` contribute to the halo for one biz of `type`? */
export function haloContribution(
  csat: number,
  type: BusinessTypeId = "cafe",
): number {
  if (csat <= MIN_CSAT) return 0;
  const normalized = Math.min(1, (csat - MIN_CSAT) / (MAX_CSAT - MIN_CSAT));
  return normalized * contributionCapFor(type);
}
