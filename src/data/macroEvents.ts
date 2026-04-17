/**
 * Macro event catalog (v0.5).
 *
 * A macro event is a timed pulse that modifies global signals the sim
 * reads (interest rate, consumer wallet, real-estate multiplier, labor
 * cost multiplier) and — via rivalReactions — nudges rival AI behavior.
 *
 * Design:
 *   - All pulses are additive/multiplicative deltas on top of the base
 *     macro cycle, not replacements. A recession stacked with the cycle's
 *     trough gets darker; stacked with a peak, it just tempers euphoria.
 *   - Events are self-contained: {duration, cooldown, weight} are tuned
 *     here, not in caller code.
 *   - Severity is a label, not a magnitude; actual magnitude lives in
 *     the pulse fields. But the label drives UI tone.
 *   - The catalog hits all four macro levers (rates, wallet, realestate,
 *     labor) and layers v0.4-specific hospitality / cogs effects.
 *
 * Tuning targets:
 *   - With weight 1.0 at 6% weekly roll chance, a given event fires
 *     once every ~20–40 weeks of play on average.
 *   - Cooldowns are tuned so no single event monopolizes a game.
 */

import type { MacroEventDef } from "@/types/game";

const WEEKS = (n: number) => n * 24 * 7;

export const MACRO_EVENTS: MacroEventDef[] = [
  // --- Rates ---
  {
    id: "rate_spike",
    category: "rates",
    title: "Fed rate spike",
    detail:
      "The central bank raised rates to fight inflation. New loans are more expensive; existing fixed-rate mortgages look smarter.",
    durationTicks: WEEKS(12),
    severity: "strong",
    tone: "negative",
    pulse: { interestRateDelta: 0.015 },
    weight: 1.2,
    cooldownTicks: WEEKS(24),
  },
  {
    id: "rate_cut",
    category: "rates",
    title: "Fed rate cut",
    detail:
      "Rates eased. Cheap money is back on the table — new loans and refi look attractive.",
    durationTicks: WEEKS(12),
    severity: "mild",
    tone: "positive",
    pulse: { interestRateDelta: -0.01 },
    weight: 1.0,
    cooldownTicks: WEEKS(24),
  },

  // --- Consumer wallet ---
  {
    id: "recession_fears",
    category: "wallet",
    title: "Recession fears",
    detail:
      "Consumers tighten spending across the board. Foot traffic dips and price-elastic menus feel it first.",
    durationTicks: WEEKS(16),
    severity: "strong",
    tone: "negative",
    pulse: { consumerWalletMul: 0.88 },
    weight: 1.2,
    cooldownTicks: WEEKS(32),
  },
  {
    id: "consumer_boom",
    category: "wallet",
    title: "Consumer boom",
    detail:
      "Paychecks are flush. Premium menu items outperform; CSAT halos amplify.",
    durationTicks: WEEKS(12),
    severity: "mild",
    tone: "positive",
    pulse: { consumerWalletMul: 1.1 },
    weight: 1.0,
    cooldownTicks: WEEKS(24),
  },

  // --- Real estate ---
  {
    id: "housing_downturn",
    category: "realestate",
    title: "Housing downturn",
    detail:
      "Commercial property values roll over. Appraisals sag — but sharp buyers can snap up distressed listings.",
    durationTicks: WEEKS(20),
    severity: "strong",
    tone: "mixed",
    pulse: { realEstateMul: 0.82 },
    weight: 0.9,
    cooldownTicks: WEEKS(40),
  },
  {
    id: "housing_rally",
    category: "realestate",
    title: "Housing rally",
    detail:
      "Commercial values rip higher. Your equity appreciates — so does what rivals can pay for listings.",
    durationTicks: WEEKS(16),
    severity: "mild",
    tone: "positive",
    pulse: { realEstateMul: 1.14 },
    weight: 0.9,
    cooldownTicks: WEEKS(40),
  },

  // --- Hospitality-specific ---
  {
    id: "liquor_tax_hike",
    category: "hospitality",
    title: "Liquor tax hike",
    detail:
      "State bumped alcohol excise tax. Bar + restaurant license fees jump 50% for the quarter.",
    durationTicks: WEEKS(8),
    severity: "mild",
    tone: "negative",
    pulse: { liquorLicenseFeeMul: 1.5 },
    weight: 0.8,
    cooldownTicks: WEEKS(32),
  },
  {
    id: "viral_food_trend",
    category: "hospitality",
    title: "Viral food trend",
    detail:
      "A food-scene moment is sweeping social feeds. Restaurants see an outsized traffic bump.",
    durationTicks: WEEKS(6),
    severity: "mild",
    tone: "positive",
    pulse: { trafficMulByType: { restaurant: 1.2 } },
    weight: 0.9,
    cooldownTicks: WEEKS(20),
  },

  // --- COGS / supply chain ---
  {
    id: "commodity_shortage",
    category: "cogs",
    title: "Commodity shortage",
    detail:
      "A supply squeeze hits ingredient and inventory costs across the board. COGS up ~12% until it clears.",
    durationTicks: WEEKS(10),
    severity: "strong",
    tone: "negative",
    pulse: { cogsMul: 1.12 },
    weight: 1.0,
    cooldownTicks: WEEKS(26),
  },

  // --- Labor ---
  {
    id: "labor_scarcity",
    category: "labor",
    title: "Labor scarcity",
    detail:
      "Tight hiring market. Wages drift up ~10%; operators who front-run it retain staff; slow-movers lose people.",
    durationTicks: WEEKS(12),
    severity: "mild",
    tone: "negative",
    pulse: { laborCostMul: 1.1 },
    weight: 1.0,
    cooldownTicks: WEEKS(28),
  },
];

export const MACRO_EVENTS_BY_ID: Record<string, MacroEventDef> =
  Object.fromEntries(MACRO_EVENTS.map((e) => [e.id, e]));
