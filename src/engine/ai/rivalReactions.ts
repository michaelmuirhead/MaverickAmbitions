/**
 * Rival reactions to macro shocks (v0.5).
 *
 * A macro event nudges rival scoring in `strategy.ts` by returning a
 * {@link RivalEventBias} bundle. Biases are *additive adjustments* on top
 * of baseline scoring — they do not replace it. A rival still weighs
 * capital, saturation, and personality as usual; shocks just tilt the
 * scales for the duration of the pulse.
 *
 * Per-personality playbook summary:
 *
 *   rate_spike (rates up, negative shock)
 *     • predator  — opportunistic; price-wars existing owners they hope to
 *                   buy on the rebound
 *     • tycoon    — pauses new buys (financing is punitive)
 *     • operator  — preserves cash; no new opens
 *     • disruptor — leans *into* pricing pressure (cheap wins share)
 *     • politician — banks cash and influence
 *
 *   rate_cut (rates down, mild positive)
 *     • predator, disruptor — open aggressively (cheap capital)
 *     • tycoon  — buys property (financing is attractive)
 *     • operator — cautiously opens only if the fundamentals still hold
 *
 *   recession_fears (wallet shrinks, strong negative)
 *     • operator — preserves cash, hires defensively, no new opens
 *     • disruptor — price-wars to seize share from stressed competitors
 *     • predator — starts positioning for distressed acquisitions
 *     • tycoon   — watches; may swoop on distressed property
 *
 *   consumer_boom (wallet grows, positive)
 *     • everyone opens more readily; predators + disruptors press hardest
 *     • operator leans into marketing (now the time)
 *
 *   housing_downturn (RE rolls over, mixed — bad for holders, good for buyers)
 *     • tycoon   — major property-buy bias (this is their lane)
 *     • operator — picks off mid-quality listings
 *     • disruptor/predator — ignore property, keep hunting biz opens
 *
 *   housing_rally (RE up)
 *     • nobody piles in at the top; mild reduction in buy_property
 *
 *   liquor_tax_hike (hospitality, mild negative)
 *     • predator — piles into cafes (competitor bars squeezed; cafes largely
 *                  unaffected by excise, halo still plays)
 *     • operator — hiring boost (retains staff while rivals trim)
 *
 *   viral_food_trend (hospitality, positive)
 *     • everyone boosts restaurant/cafe opens
 *     • disruptor — bias toward restaurant price wars (ride the wave)
 *
 *   commodity_shortage (COGS up, strong negative)
 *     • operator  — preserves cash, no opens, no marketing
 *     • disruptor — keeps pushing (thin margins is their home turf)
 *     • predator  — waits for weak hands; no new opens
 *
 *   labor_scarcity (wages up, mild negative)
 *     • operator  — hires early (front-running the squeeze)
 *     • predator  — poaches; price_war bias unchanged
 *     • disruptor — no reaction (they already run lean)
 *
 * The bias bundle is composed multiplicatively across multiple
 * simultaneously-active events so overlapping shocks compound sensibly.
 */

import type {
  ActiveMacroEvent,
  AIRival,
  BusinessTypeId,
  MacroEventCategory,
  MacroEventId,
} from "@/types/game";

import { MACRO_EVENTS_BY_ID } from "@/data/macroEvents";

export interface RivalEventBias {
  /** Multiplier applied to the utility of `open_business` for this type. */
  typeUtilityMultiplier: Partial<Record<BusinessTypeId, number>>;
  /** Overall appetite to open any new business. 1.0 = unchanged. */
  openBusinessMultiplier: number;
  /** Additive boost to `buy_property` utility. */
  propertyBuyBoost: number;
  /** Additive boost to `invest_marketing` utility. */
  marketingBoost: number;
  /** Additive boost to `price_war` utility. */
  priceWarBoost: number;
  /** Additive boost to `hire_staff` utility. */
  hireStaffBoost: number;
  /** Additional utility on `no_op` — when a rival should sit on their hands. */
  noOpBoost: number;
  /** Short human-readable reasons, for debug/log lines. */
  reasons: string[];
}

function emptyBias(): RivalEventBias {
  return {
    typeUtilityMultiplier: {},
    openBusinessMultiplier: 1,
    propertyBuyBoost: 0,
    marketingBoost: 0,
    priceWarBoost: 0,
    hireStaffBoost: 0,
    noOpBoost: 0,
    reasons: [],
  };
}

/** Multiplicatively scale a type utility entry (defaulting to 1). */
function bumpTypeUtil(
  bias: RivalEventBias,
  type: BusinessTypeId,
  factor: number,
): void {
  bias.typeUtilityMultiplier[type] =
    (bias.typeUtilityMultiplier[type] ?? 1) * factor;
}

/**
 * Per-personality reaction to a single event. Returns a delta bias that
 * the caller composes into the running total. Extracting this keeps the
 * big switch readable and unit-testable.
 */
function reactTo(
  personality: AIRival["personality"],
  defId: MacroEventId,
  category: MacroEventCategory,
): RivalEventBias {
  const bias = emptyBias();

  switch (category) {
    case "rates": {
      if (defId === "rate_spike") {
        if (personality === "tycoon") {
          bias.openBusinessMultiplier *= 0.6;
          bias.propertyBuyBoost -= 20;
          bias.noOpBoost += 10;
          bias.reasons.push("Tycoon waits out rate spike.");
        } else if (personality === "operator") {
          bias.openBusinessMultiplier *= 0.7;
          bias.noOpBoost += 8;
          bias.reasons.push("Operator preserves cash through the spike.");
        } else if (personality === "disruptor") {
          bias.priceWarBoost += 15;
          bias.reasons.push("Disruptor leans into price pressure.");
        } else if (personality === "predator") {
          bias.priceWarBoost += 10;
          bias.propertyBuyBoost -= 8;
          bias.reasons.push("Predator squeezes with pricing, waits on RE.");
        } else if (personality === "politician") {
          bias.openBusinessMultiplier *= 0.8;
          bias.noOpBoost += 6;
          bias.reasons.push("Politician banks cash during tightening.");
        }
      } else if (defId === "rate_cut") {
        if (personality === "tycoon") {
          bias.propertyBuyBoost += 18;
          bias.openBusinessMultiplier *= 1.1;
          bias.reasons.push("Tycoon ramps RE buys on the cut.");
        } else if (personality === "predator" || personality === "disruptor") {
          bias.openBusinessMultiplier *= 1.2;
          bias.reasons.push("Cheap capital — aggressive opens.");
        } else if (personality === "operator") {
          bias.openBusinessMultiplier *= 1.05;
          bias.reasons.push("Operator cautiously opens.");
        }
      }
      return bias;
    }

    case "wallet": {
      if (defId === "recession_fears") {
        if (personality === "operator") {
          bias.openBusinessMultiplier *= 0.55;
          bias.marketingBoost -= 10;
          bias.hireStaffBoost += 4;
          bias.noOpBoost += 10;
          bias.reasons.push("Operator hunkers down through the recession.");
        } else if (personality === "disruptor") {
          bias.priceWarBoost += 18;
          bias.openBusinessMultiplier *= 0.9;
          bias.reasons.push("Disruptor seizes share from stressed rivals.");
        } else if (personality === "predator") {
          bias.propertyBuyBoost += 12;
          bias.priceWarBoost += 8;
          bias.reasons.push("Predator positions for distressed buys.");
        } else if (personality === "tycoon") {
          bias.openBusinessMultiplier *= 0.75;
          bias.propertyBuyBoost += 6;
          bias.reasons.push("Tycoon stays patient; watching for bargains.");
        } else if (personality === "politician") {
          bias.openBusinessMultiplier *= 0.7;
          bias.noOpBoost += 5;
          bias.reasons.push("Politician banks capital.");
        }
      } else if (defId === "consumer_boom") {
        if (personality === "predator" || personality === "disruptor") {
          bias.openBusinessMultiplier *= 1.25;
          bias.reasons.push("Spending is up — opens aggressively.");
        } else if (personality === "operator") {
          bias.marketingBoost += 10;
          bias.reasons.push("Operator leans into marketing.");
        } else {
          bias.openBusinessMultiplier *= 1.1;
        }
      }
      return bias;
    }

    case "realestate": {
      if (defId === "housing_downturn") {
        if (personality === "tycoon") {
          bias.propertyBuyBoost += 30;
          bias.reasons.push("Tycoon feasts on distressed listings.");
        } else if (personality === "operator") {
          bias.propertyBuyBoost += 12;
          bias.reasons.push("Operator picks up mid-quality properties.");
        } else if (personality === "politician") {
          bias.propertyBuyBoost += 8;
          bias.reasons.push("Politician quietly accumulates holdings.");
        } else {
          bias.propertyBuyBoost -= 4;
        }
      } else if (defId === "housing_rally") {
        bias.propertyBuyBoost -= 10;
        if (personality === "tycoon" || personality === "operator") {
          bias.reasons.push("Won't chase RE at the top.");
        }
      }
      return bias;
    }

    case "hospitality": {
      if (defId === "liquor_tax_hike") {
        if (personality === "predator") {
          bumpTypeUtil(bias, "cafe", 1.25);
          bumpTypeUtil(bias, "bar", 0.85);
          bias.reasons.push("Predator piles into cafes; bars hurt.");
        } else if (personality === "operator") {
          bias.hireStaffBoost += 6;
          bumpTypeUtil(bias, "bar", 0.9);
          bias.reasons.push("Operator retains staff; cautious on bars.");
        } else if (personality === "disruptor") {
          bumpTypeUtil(bias, "bar", 0.9);
        } else if (personality === "tycoon") {
          bumpTypeUtil(bias, "bar", 0.9);
        }
      } else if (defId === "viral_food_trend") {
        bumpTypeUtil(bias, "restaurant", 1.3);
        bumpTypeUtil(bias, "cafe", 1.1);
        if (personality === "disruptor") {
          bias.priceWarBoost += 10;
          bias.reasons.push("Disruptor rides the wave with price pressure.");
        } else if (personality === "predator" || personality === "tycoon") {
          bias.reasons.push("Food-scene moment — opens on trend.");
        }
      }
      return bias;
    }

    case "cogs": {
      // commodity_shortage
      if (personality === "operator") {
        bias.openBusinessMultiplier *= 0.55;
        bias.marketingBoost -= 8;
        bias.noOpBoost += 10;
        bias.reasons.push("Operator preserves cash through COGS squeeze.");
      } else if (personality === "disruptor") {
        bias.priceWarBoost += 8;
        bias.reasons.push("Thin margins is home turf for disruptors.");
      } else if (personality === "predator") {
        bias.openBusinessMultiplier *= 0.8;
        bias.priceWarBoost += 6;
        bias.propertyBuyBoost += 4;
        bias.reasons.push("Predator waits for weak hands.");
      } else if (personality === "tycoon") {
        bias.openBusinessMultiplier *= 0.7;
        bias.reasons.push("Tycoon pauses opens during shortage.");
      } else if (personality === "politician") {
        bias.noOpBoost += 4;
      }
      return bias;
    }

    case "labor": {
      // labor_scarcity
      if (personality === "operator") {
        bias.hireStaffBoost += 16;
        bias.reasons.push("Operator front-runs the wage squeeze.");
      } else if (personality === "predator") {
        bias.hireStaffBoost += 8;
        bias.priceWarBoost += 4;
        bias.reasons.push("Predator poaches staff.");
      } else if (personality === "tycoon") {
        bias.hireStaffBoost += 6;
      } else if (personality === "disruptor") {
        // No reaction; they already run lean.
      } else if (personality === "politician") {
        bias.hireStaffBoost += 4;
      }
      return bias;
    }
  }
  return bias;
}

/**
 * Compose per-personality biases across all currently-active events.
 * Multipliers multiply; additive boosts add.
 */
export function getRivalEventBias(
  rival: AIRival,
  activeEvents: ActiveMacroEvent[],
): RivalEventBias {
  const total = emptyBias();
  if (activeEvents.length === 0) return total;

  for (const a of activeEvents) {
    const def = MACRO_EVENTS_BY_ID[a.defId];
    if (!def) continue;
    const delta = reactTo(rival.personality, a.defId, def.category);

    total.openBusinessMultiplier *= delta.openBusinessMultiplier;
    total.propertyBuyBoost += delta.propertyBuyBoost;
    total.marketingBoost += delta.marketingBoost;
    total.priceWarBoost += delta.priceWarBoost;
    total.hireStaffBoost += delta.hireStaffBoost;
    total.noOpBoost += delta.noOpBoost;
    for (const [type, mul] of Object.entries(delta.typeUtilityMultiplier)) {
      const key = type as BusinessTypeId;
      total.typeUtilityMultiplier[key] =
        (total.typeUtilityMultiplier[key] ?? 1) * (mul ?? 1);
    }
    if (delta.reasons.length > 0) total.reasons.push(...delta.reasons);
  }

  return total;
}

/**
 * Tiny helper: did any active event trigger *any* reaction for this rival?
 * Useful for UI (showing a "reacting to shocks" indicator) and for the
 * debug console.
 */
export function hasReaction(bias: RivalEventBias): boolean {
  return (
    bias.openBusinessMultiplier !== 1 ||
    bias.propertyBuyBoost !== 0 ||
    bias.marketingBoost !== 0 ||
    bias.priceWarBoost !== 0 ||
    bias.hireStaffBoost !== 0 ||
    bias.noOpBoost !== 0 ||
    Object.keys(bias.typeUtilityMultiplier).length > 0
  );
}
