/**
 * Market → business-type fit scoring (v0.9 Failure & Flow).
 *
 * The MarketPage used to render one big flat grid of every business
 * type. With 22 types and 46 markets that quickly became an
 * unstructured mess. The recommendation engine scores (market, type)
 * pairs along three market axes (population, income, desirability) so
 * the UI can surface a "Good fits" cluster at the top.
 *
 * Each business type is tagged with a preference profile — the bands
 * of the three axes where it tends to perform well. The score is a
 * weighted average of per-axis triangular memberships in [0, 1], with
 * optional bonuses/penalties for crowded markets and unlock gating.
 *
 * This is intentionally a heuristic, not a simulator. The goal is to
 * answer "what would obviously work here" in a way that matches the
 * intuition a real operator would form after a neighborhood walk; the
 * sim itself still arbitrates the actual outcome. Tests should stay
 * tolerant of small numeric shifts — we rank more than we measure.
 */
import type {
  BusinessTypeId,
  Market,
  PlayerCharacter,
} from "@/types/game";

import { getBusinessModule } from "@/engine/business/registry";

/** A preference band on one market axis. Targets are in the axis's raw units. */
interface Band {
  /** Value with full (1.0) fit. */
  ideal: number;
  /** Half-width of the triangular membership — distance at which fit drops to 0. */
  halfWidth: number;
  /** Hard floor — below this, the business won't work at all. Optional. */
  min?: number;
}

/** Per-axis preference profile. Weights must sum to 1. */
interface FitProfile {
  population: Band;
  income: Band; // in cents
  desirability: Band;
  weights: { population: number; income: number; desirability: number };
  /** Short archetype tag used for reason strings. */
  archetype:
    | "luxury"
    | "mass-market"
    | "food-service"
    | "nightlife"
    | "entertainment"
    | "knowledge"
    | "trades"
    | "health"
    | "industrial"
    | "niche";
}

/** Convert dollars → cents for readability in the table below. */
const $ = (dollars: number) => dollars * 100;

/**
 * Profile table. Hand-tuned; tweak freely. Any business type without
 * an entry gets the DEFAULT_PROFILE so the UI never shows a blank.
 */
const PROFILES: Partial<Record<BusinessTypeId, FitProfile>> = {
  // ---- Luxury / premium retail: high income + high desirability ----
  jewelry_store: luxury(),
  suit_store: luxury(),
  furniture_store: {
    archetype: "luxury",
    population: { ideal: 30_000, halfWidth: 25_000 },
    income: { ideal: $(120_000), halfWidth: $(60_000), min: $(65_000) },
    desirability: { ideal: 0.7, halfWidth: 0.4 },
    weights: { population: 0.2, income: 0.5, desirability: 0.3 },
  },

  // ---- Mass-market retail: lives on population, middle income ----
  corner_store: massMarket(),
  supermarket: {
    archetype: "mass-market",
    population: { ideal: 55_000, halfWidth: 35_000 },
    income: { ideal: $(60_000), halfWidth: $(55_000) },
    desirability: { ideal: 0.4, halfWidth: 0.45 },
    weights: { population: 0.6, income: 0.25, desirability: 0.15 },
  },
  bookstore: {
    archetype: "mass-market",
    population: { ideal: 30_000, halfWidth: 25_000 },
    income: { ideal: $(85_000), halfWidth: $(45_000) },
    desirability: { ideal: 0.65, halfWidth: 0.35 },
    weights: { population: 0.3, income: 0.4, desirability: 0.3 },
  },
  electronics_store: massMarket(),
  clothing_retail: massMarket(),
  florist: {
    archetype: "niche",
    population: { ideal: 25_000, halfWidth: 20_000 },
    income: { ideal: $(80_000), halfWidth: $(45_000) },
    desirability: { ideal: 0.65, halfWidth: 0.4 },
    weights: { population: 0.35, income: 0.3, desirability: 0.35 },
  },

  // ---- Food service ----
  cafe: foodService(),
  restaurant: {
    archetype: "food-service",
    population: { ideal: 40_000, halfWidth: 30_000 },
    income: { ideal: $(80_000), halfWidth: $(45_000) },
    desirability: { ideal: 0.7, halfWidth: 0.4 },
    weights: { population: 0.3, income: 0.35, desirability: 0.35 },
  },
  pizza_shop: {
    archetype: "food-service",
    population: { ideal: 35_000, halfWidth: 30_000 },
    income: { ideal: $(55_000), halfWidth: $(45_000) },
    desirability: { ideal: 0.45, halfWidth: 0.4 },
    weights: { population: 0.55, income: 0.2, desirability: 0.25 },
  },
  food_truck: {
    archetype: "food-service",
    population: { ideal: 30_000, halfWidth: 25_000 },
    income: { ideal: $(55_000), halfWidth: $(50_000) },
    desirability: { ideal: 0.55, halfWidth: 0.45 },
    weights: { population: 0.5, income: 0.2, desirability: 0.3 },
  },

  // ---- Nightlife ----
  bar: nightlife(),
  nightclub: {
    archetype: "nightlife",
    population: { ideal: 50_000, halfWidth: 25_000, min: 20_000 },
    income: { ideal: $(75_000), halfWidth: $(50_000) },
    desirability: { ideal: 0.8, halfWidth: 0.3, min: 0.4 },
    weights: { population: 0.35, income: 0.25, desirability: 0.4 },
  },

  // ---- Entertainment venues ----
  cinema: {
    archetype: "entertainment",
    population: { ideal: 50_000, halfWidth: 25_000, min: 20_000 },
    income: { ideal: $(70_000), halfWidth: $(50_000) },
    desirability: { ideal: 0.6, halfWidth: 0.4 },
    weights: { population: 0.55, income: 0.2, desirability: 0.25 },
  },

  // ---- Knowledge / creative work: dense urban, high desirability ----
  tech_startup: knowledge(),
  gaming_studio: knowledge(),
  movie_studio: {
    archetype: "knowledge",
    population: { ideal: 50_000, halfWidth: 35_000 },
    income: { ideal: $(100_000), halfWidth: $(55_000) },
    desirability: { ideal: 0.8, halfWidth: 0.3, min: 0.4 },
    weights: { population: 0.25, income: 0.3, desirability: 0.45 },
  },

  // ---- Trades / services ----
  construction: {
    archetype: "trades",
    population: { ideal: 35_000, halfWidth: 30_000 },
    income: { ideal: $(70_000), halfWidth: $(50_000) },
    // Construction firms prefer moderate desirability — not so premium
    // that land is priced out, not so rough that labor is scarce.
    desirability: { ideal: 0.5, halfWidth: 0.4 },
    weights: { population: 0.4, income: 0.3, desirability: 0.3 },
  },
  real_estate_firm: {
    archetype: "trades",
    population: { ideal: 45_000, halfWidth: 30_000 },
    income: { ideal: $(95_000), halfWidth: $(55_000) },
    desirability: { ideal: 0.7, halfWidth: 0.35 },
    weights: { population: 0.35, income: 0.3, desirability: 0.35 },
  },

  // ---- Health ----
  hospital_clinic: {
    archetype: "health",
    population: { ideal: 60_000, halfWidth: 35_000, min: 15_000 },
    income: { ideal: $(80_000), halfWidth: $(55_000) },
    desirability: { ideal: 0.55, halfWidth: 0.45 },
    weights: { population: 0.55, income: 0.25, desirability: 0.2 },
  },

  // ---- Heavy industry: low desirability (cheap land), big workforce ----
  oil_gas: {
    archetype: "industrial",
    population: { ideal: 25_000, halfWidth: 25_000 },
    income: { ideal: $(50_000), halfWidth: $(45_000) },
    // Inverted: industrial firms thrive where land is cheap.
    desirability: { ideal: 0.25, halfWidth: 0.35 },
    weights: { population: 0.3, income: 0.2, desirability: 0.5 },
  },
  military_tech: {
    archetype: "industrial",
    population: { ideal: 40_000, halfWidth: 30_000 },
    income: { ideal: $(85_000), halfWidth: $(50_000) },
    desirability: { ideal: 0.35, halfWidth: 0.4 },
    weights: { population: 0.35, income: 0.25, desirability: 0.4 },
  },
};

const DEFAULT_PROFILE: FitProfile = {
  archetype: "niche",
  population: { ideal: 35_000, halfWidth: 30_000 },
  income: { ideal: $(75_000), halfWidth: $(50_000) },
  desirability: { ideal: 0.55, halfWidth: 0.45 },
  weights: { population: 0.34, income: 0.33, desirability: 0.33 },
};

function luxury(): FitProfile {
  return {
    archetype: "luxury",
    population: { ideal: 35_000, halfWidth: 30_000 },
    income: { ideal: $(130_000), halfWidth: $(55_000), min: $(70_000) },
    desirability: { ideal: 0.85, halfWidth: 0.3, min: 0.5 },
    weights: { population: 0.15, income: 0.45, desirability: 0.4 },
  };
}

function massMarket(): FitProfile {
  return {
    archetype: "mass-market",
    population: { ideal: 45_000, halfWidth: 35_000 },
    income: { ideal: $(60_000), halfWidth: $(50_000) },
    desirability: { ideal: 0.45, halfWidth: 0.45 },
    weights: { population: 0.55, income: 0.25, desirability: 0.2 },
  };
}

function foodService(): FitProfile {
  return {
    archetype: "food-service",
    population: { ideal: 35_000, halfWidth: 30_000 },
    income: { ideal: $(75_000), halfWidth: $(45_000) },
    desirability: { ideal: 0.65, halfWidth: 0.4 },
    weights: { population: 0.4, income: 0.3, desirability: 0.3 },
  };
}

function nightlife(): FitProfile {
  return {
    archetype: "nightlife",
    population: { ideal: 40_000, halfWidth: 25_000, min: 15_000 },
    income: { ideal: $(70_000), halfWidth: $(50_000) },
    desirability: { ideal: 0.7, halfWidth: 0.35, min: 0.3 },
    weights: { population: 0.4, income: 0.25, desirability: 0.35 },
  };
}

function knowledge(): FitProfile {
  return {
    archetype: "knowledge",
    population: { ideal: 45_000, halfWidth: 35_000 },
    income: { ideal: $(110_000), halfWidth: $(50_000) },
    desirability: { ideal: 0.8, halfWidth: 0.3, min: 0.4 },
    weights: { population: 0.2, income: 0.3, desirability: 0.5 },
  };
}

/** Triangular membership peaking at `ideal` with zero outside `ideal ± halfWidth`. */
function triangularFit(value: number, band: Band): number {
  if (band.min !== undefined && value < band.min) return 0;
  const d = Math.abs(value - band.ideal);
  if (d >= band.halfWidth) return 0;
  return 1 - d / band.halfWidth;
}

/** Build one short reason string describing the axis contribution. */
function reasonForAxis(
  axis: "population" | "income" | "desirability",
  fit: number,
  market: Market,
  profile: FitProfile,
): string | undefined {
  if (fit < 0.5) return undefined;
  switch (axis) {
    case "population":
      return market.population >= profile.population.ideal * 0.8
        ? `Dense population (${formatPop(market.population)}) supports the foot-traffic model`
        : `Population (${formatPop(market.population)}) is a good size for this format`;
    case "income":
      return market.medianIncome >= profile.income.ideal * 0.8
        ? `High median income ($${Math.round(market.medianIncome / 100 / 1000)}K) matches ${archLabel(profile.archetype)} pricing`
        : `Median income ($${Math.round(market.medianIncome / 100 / 1000)}K) fits ${archLabel(profile.archetype)} customers`;
    case "desirability":
      return profile.archetype === "industrial"
        ? market.desirability <= 0.45
          ? "Low desirability means cheap land and lenient zoning"
          : undefined
        : market.desirability >= 0.7
          ? "Premium neighborhood reputation attracts walk-ins and talent"
          : "Neighborhood character aligns with this format";
  }
}

function archLabel(a: FitProfile["archetype"]): string {
  switch (a) {
    case "luxury":
      return "luxury";
    case "mass-market":
      return "mass-market";
    case "food-service":
      return "casual-dining";
    case "nightlife":
      return "nightlife";
    case "entertainment":
      return "mass-entertainment";
    case "knowledge":
      return "knowledge-work";
    case "trades":
      return "trades";
    case "health":
      return "clinical";
    case "industrial":
      return "industrial";
    case "niche":
      return "specialty";
  }
}

function formatPop(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
}

// ---------- Public API ----------

export interface BizFitScore {
  /** 0..1 overall score. 0 = never; 1 = textbook fit. */
  score: number;
  /** 1–3 short reason phrases. Empty when score is poor. */
  reasons: string[];
  /** Player-facing blockers (unlock gates, hard minimums). */
  blockers: string[];
  /** Archetype tag useful for UI filters. */
  archetype: FitProfile["archetype"];
}

/** Threshold above which a type is considered a "good fit" for ranking. */
export const GOOD_FIT_THRESHOLD = 0.6;

/** Score a single (market, type) pair. */
export function scoreBizTypeForMarket(
  type: BusinessTypeId,
  market: Market,
  opts?: { player?: PlayerCharacter },
): BizFitScore {
  const profile = PROFILES[type] ?? DEFAULT_PROFILE;

  const popFit = triangularFit(market.population, profile.population);
  const incFit = triangularFit(market.medianIncome, profile.income);
  const desFit = triangularFit(market.desirability, profile.desirability);

  const score =
    popFit * profile.weights.population +
    incFit * profile.weights.income +
    desFit * profile.weights.desirability;

  const reasons: string[] = [];
  const r1 = reasonForAxis("income", incFit, market, profile);
  const r2 = reasonForAxis("desirability", desFit, market, profile);
  const r3 = reasonForAxis("population", popFit, market, profile);
  for (const r of [r1, r2, r3]) if (r) reasons.push(r);

  const blockers: string[] = [];
  // Hard-floor checks — explain away score = 0.
  if (
    profile.population.min !== undefined &&
    market.population < profile.population.min
  ) {
    blockers.push(
      `Needs at least ${formatPop(profile.population.min)} population`,
    );
  }
  if (
    profile.desirability.min !== undefined &&
    market.desirability < profile.desirability.min
  ) {
    blockers.push("Desirability too low for this format");
  }
  if (
    profile.income.min !== undefined &&
    market.medianIncome < profile.income.min
  ) {
    blockers.push(
      `Needs median income above $${Math.round(profile.income.min / 100 / 1000)}K`,
    );
  }

  // Unlock gating — tell the player they can't actually open this yet.
  if (opts?.player) {
    const mod = tryGetModule(type);
    const unlockNw = mod?.startup.unlocksAt?.netWorthCents;
    if (unlockNw !== undefined) {
      // We don't have the full net-worth selector here, but personal
      // cash + a simple threshold check is enough to flag "locked".
      // The MarketPage still runs the precise check at open time.
      // Using personalCash alone underestimates — acceptable, as
      // blockers are advisory, not authoritative.
      const approx = opts.player.personalCash;
      if (approx < unlockNw) {
        blockers.push(
          `Unlocks at $${Math.round(unlockNw / 100 / 1000)}K net worth`,
        );
      }
    }
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    reasons: reasons.slice(0, 3),
    blockers,
    archetype: profile.archetype,
  };
}

export interface MarketRecommendation {
  type: BusinessTypeId;
  score: number;
  reasons: string[];
  archetype: FitProfile["archetype"];
}

/**
 * Rank a list of business types for a market. Types with score below
 * `minScore` are dropped. Default minScore = GOOD_FIT_THRESHOLD.
 */
export function recommendForMarket(
  market: Market,
  types: BusinessTypeId[],
  opts?: {
    player?: PlayerCharacter;
    minScore?: number;
    topN?: number;
  },
): MarketRecommendation[] {
  const min = opts?.minScore ?? GOOD_FIT_THRESHOLD;
  const ranked: MarketRecommendation[] = [];
  for (const type of types) {
    const fit = scoreBizTypeForMarket(type, market, { player: opts?.player });
    if (fit.score < min) continue;
    // Exclude types that are hard-blocked from unlock gating — they'd
    // clutter the "good fits" row with things the player can't open.
    if (fit.blockers.some((b) => b.startsWith("Unlocks at"))) continue;
    ranked.push({
      type,
      score: fit.score,
      reasons: fit.reasons,
      archetype: fit.archetype,
    });
  }
  ranked.sort((a, b) => b.score - a.score);
  if (opts?.topN) return ranked.slice(0, opts.topN);
  return ranked;
}

function tryGetModule(type: BusinessTypeId) {
  try {
    return getBusinessModule(type);
  } catch {
    return undefined;
  }
}
