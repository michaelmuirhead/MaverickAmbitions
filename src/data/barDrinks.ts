/**
 * Bar drink catalog. Cents.
 *
 * Bars are not cafes — throughput is set by pour time (fast) but the
 * mix matters: a draft-heavy bar turns quickly; a cocktail den trades
 * volume for margin. Each drink carries a `prepSeconds` so bartender
 * throughput can be modeled, and a `liquorCost` that scales with the
 * bar's chosen shelf tier.
 */

import type { Cents } from "@/types/game";

export type DrinkId =
  | "draft_lager"
  | "ipa"
  | "wine_glass"
  | "well_spirit"
  | "house_cocktail"
  | "signature_cocktail"
  | "shot"
  | "soda";

export type DrinkCategory = "beer" | "wine" | "spirit" | "cocktail" | "soft";

export interface DrinkDef {
  id: DrinkId;
  category: DrinkCategory;
  /** Wholesale pour cost at 'call' tier. Well tier ≈ 0.75×, top-shelf ≈ 1.45×. */
  baseCost: Cents;
  /** Menu price at 'call' tier. */
  basePrice: Cents;
  /** Seconds for a mid-skill bartender to pour. */
  prepSeconds: number;
  /** Base per-hour demand weight (relative). */
  popularity: number;
  /** True if this is subject to happy-hour discount. */
  happyHourEligible: boolean;
}

export const BAR_DRINKS: DrinkDef[] = [
  { id: "draft_lager",         category: "beer",     baseCost: 100, basePrice: 600,  prepSeconds: 15, popularity: 1.4, happyHourEligible: true  },
  { id: "ipa",                 category: "beer",     baseCost: 130, basePrice: 700,  prepSeconds: 15, popularity: 1.0, happyHourEligible: true  },
  { id: "wine_glass",          category: "wine",     baseCost: 220, basePrice: 900,  prepSeconds: 10, popularity: 0.7, happyHourEligible: true  },
  { id: "well_spirit",         category: "spirit",   baseCost: 150, basePrice: 700,  prepSeconds: 10, popularity: 0.9, happyHourEligible: true  },
  { id: "house_cocktail",      category: "cocktail", baseCost: 310, basePrice: 1200, prepSeconds: 90, popularity: 0.9, happyHourEligible: false },
  { id: "signature_cocktail",  category: "cocktail", baseCost: 420, basePrice: 1500, prepSeconds: 140, popularity: 0.6, happyHourEligible: false },
  { id: "shot",                category: "spirit",   baseCost: 180, basePrice: 800,  prepSeconds: 10, popularity: 0.5, happyHourEligible: false },
  { id: "soda",                category: "soft",     baseCost: 20,  basePrice: 250,  prepSeconds: 5,  popularity: 0.3, happyHourEligible: false },
];

export const DRINK_LABELS: Record<DrinkId, string> = {
  draft_lager: "Draft Lager",
  ipa: "IPA",
  wine_glass: "Wine by the Glass",
  well_spirit: "Well Spirit",
  house_cocktail: "House Cocktail",
  signature_cocktail: "Signature Cocktail",
  shot: "Shot",
  soda: "Soda / Mixer",
};
