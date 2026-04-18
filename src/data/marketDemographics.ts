/**
 * Per-market demographic overlay (v0.10).
 *
 * Kept in a separate file from `markets.ts` to keep the 46-market roster
 * readable. `markets.ts` merges these values onto each market at module
 * load time, so UI and engine callers read `market.demographics` without
 * plumbing the overlay.
 *
 * Numbers are hand-tuned per archetype band:
 *   - Central city: 23 (student) → 52 (old town) median age
 *   - Suburbs: 37 (young family) → 56 (old money)
 *   - Rural: 44 → 68 (retirement community)
 *   - Specialty commercial: 24 (campus) → 43 (convention)
 *   - Coastal / resort: 38 (mass-market beach) → 52 (yacht club)
 *   - Industrial / port: 41 → 47
 *
 * ageSkew: −1 (heavy young-skew) .. +1 (heavy old-skew) — shape of the
 *   distribution around the median, not the median itself
 * incomeSkew: −1 (tight distribution, everyone near median) .. +1 (barbell
 *   / wide spread between rich and poor within the market)
 *
 * Markets absent from this map fall back to a neutral default in
 * `markets.ts`.
 */

import type { Demographics, Id } from "@/types/game";

import { dollars } from "@/lib/money";

type DemographicsInput = {
  medianAge: number;
  medianIncome: number; // whole dollars — converted to cents below
  ageSkew: number;
  incomeSkew: number;
};

const RAW: Record<Id, DemographicsInput> = {
  // ---------- Central city ----------
  m_downtown:            { medianAge: 36, medianIncome: 72_000,  ageSkew: 0.10, incomeSkew: 0.20 },
  m_riverside:           { medianAge: 33, medianIncome: 58_000,  ageSkew: -0.20, incomeSkew: 0.00 },
  m_oak_hills:           { medianAge: 48, medianIncome: 96_000,  ageSkew: 0.50, incomeSkew: 0.30 },
  m_southside:           { medianAge: 38, medianIncome: 42_000,  ageSkew: 0.00, incomeSkew: -0.30 },

  // ---------- Greater metro urban ----------
  m_midtown:             { medianAge: 36, medianIncome: 64_000,  ageSkew: 0.05, incomeSkew: 0.00 },
  m_warehouse_district:  { medianAge: 30, medianIncome: 54_000,  ageSkew: -0.55, incomeSkew: -0.10 },
  m_university_heights:  { medianAge: 23, medianIncome: 32_000,  ageSkew: -0.95, incomeSkew: -0.50 },
  m_harborview:          { medianAge: 42, medianIncome: 82_000,  ageSkew: 0.20, incomeSkew: 0.40 },
  m_silverlake:          { medianAge: 35, medianIncome: 118_000, ageSkew: -0.20, incomeSkew: 0.55 },
  m_old_town:            { medianAge: 52, medianIncome: 68_000,  ageSkew: 0.55, incomeSkew: 0.10 },
  m_arts_district:       { medianAge: 31, medianIncome: 51_000,  ageSkew: -0.45, incomeSkew: -0.10 },
  m_little_portugal:     { medianAge: 43, medianIncome: 47_000,  ageSkew: 0.15, incomeSkew: -0.30 },
  m_chinatown:           { medianAge: 47, medianIncome: 41_000,  ageSkew: 0.35, incomeSkew: -0.25 },
  m_garment_district:    { medianAge: 40, medianIncome: 55_000,  ageSkew: 0.00, incomeSkew: 0.00 },
  m_theater_district:    { medianAge: 45, medianIncome: 72_000,  ageSkew: 0.25, incomeSkew: 0.30 },
  m_financial_district:  { medianAge: 38, medianIncome: 125_000, ageSkew: 0.05, incomeSkew: 0.70 },

  // ---------- Suburbs ----------
  m_cedar_park:          { medianAge: 40, medianIncome: 74_000,  ageSkew: 0.15, incomeSkew: 0.00 },
  m_willow_creek:        { medianAge: 37, medianIncome: 88_000,  ageSkew: -0.05, incomeSkew: 0.10 },
  m_pine_ridge:          { medianAge: 55, medianIncome: 145_000, ageSkew: 0.65, incomeSkew: 0.50 },
  m_elmwood:             { medianAge: 52, medianIncome: 48_000,  ageSkew: 0.50, incomeSkew: -0.30 },
  m_briar_glen:          { medianAge: 39, medianIncome: 103_000, ageSkew: 0.00, incomeSkew: 0.40 },
  m_maple_grove:         { medianAge: 41, medianIncome: 69_000,  ageSkew: 0.10, incomeSkew: -0.10 },
  m_hillcrest:           { medianAge: 46, medianIncome: 94_000,  ageSkew: 0.30, incomeSkew: 0.30 },
  m_fairview_heights:    { medianAge: 49, medianIncome: 52_000,  ageSkew: 0.40, incomeSkew: -0.30 },
  m_tanglewood:          { medianAge: 56, medianIncome: 128_000, ageSkew: 0.70, incomeSkew: 0.40 },
  m_summit_ridge:        { medianAge: 42, medianIncome: 135_000, ageSkew: 0.20, incomeSkew: 0.60 },

  // ---------- Outlying / rural ----------
  m_meadowbrook:         { medianAge: 47, medianIncome: 56_000,  ageSkew: 0.30, incomeSkew: 0.10 },
  m_fort_hayward:        { medianAge: 35, medianIncome: 46_000,  ageSkew: -0.10, incomeSkew: -0.40 },
  m_junction_town:       { medianAge: 44, medianIncome: 39_000,  ageSkew: 0.20, incomeSkew: -0.40 },
  m_cypress_falls:       { medianAge: 52, medianIncome: 62_000,  ageSkew: 0.45, incomeSkew: 0.20 },
  m_stonebrook:          { medianAge: 51, medianIncome: 98_000,  ageSkew: 0.55, incomeSkew: 0.50 },
  m_copper_valley:       { medianAge: 54, medianIncome: 34_000,  ageSkew: 0.60, incomeSkew: -0.40 },
  m_willow_bend:         { medianAge: 50, medianIncome: 44_000,  ageSkew: 0.40, incomeSkew: -0.50 },
  m_pineview:            { medianAge: 68, medianIncome: 58_000,  ageSkew: 0.95, incomeSkew: -0.10 },

  // ---------- Specialty commercial ----------
  m_tech_park:           { medianAge: 36, medianIncome: 132_000, ageSkew: -0.10, incomeSkew: 0.50 },
  m_medical_district:    { medianAge: 42, medianIncome: 94_000,  ageSkew: 0.15, incomeSkew: 0.30 },
  m_airport_commons:     { medianAge: 40, medianIncome: 58_000,  ageSkew: 0.00, incomeSkew: 0.00 },
  m_convention_plaza:    { medianAge: 43, medianIncome: 71_000,  ageSkew: 0.15, incomeSkew: 0.20 },
  m_campus_commons:      { medianAge: 24, medianIncome: 38_000,  ageSkew: -0.90, incomeSkew: -0.50 },

  // ---------- Coastal / resort ----------
  m_seacliff:            { medianAge: 49, medianIncome: 118_000, ageSkew: 0.45, incomeSkew: 0.40 },
  m_marlin_harbor:       { medianAge: 45, medianIncome: 58_000,  ageSkew: 0.20, incomeSkew: 0.20 },
  m_sandy_point:         { medianAge: 38, medianIncome: 63_000,  ageSkew: 0.00, incomeSkew: -0.10 },
  m_bayshore_marina:     { medianAge: 52, medianIncome: 142_000, ageSkew: 0.50, incomeSkew: 0.70 },

  // ---------- Industrial / port ----------
  m_rust_belt:           { medianAge: 47, medianIncome: 37_000,  ageSkew: 0.30, incomeSkew: -0.50 },
  m_harbor_works:        { medianAge: 41, medianIncome: 48_000,  ageSkew: 0.10, incomeSkew: -0.30 },
  m_rail_yard:           { medianAge: 42, medianIncome: 43_000,  ageSkew: 0.10, incomeSkew: -0.40 },
};

/** Neutral default when a market id isn't in the overlay. */
const DEFAULT_DEMOGRAPHICS: Demographics = {
  medianAge: 40,
  medianIncome: dollars(65_000),
  ageSkew: 0,
  incomeSkew: 0,
};

export const MARKET_DEMOGRAPHICS: Record<Id, Demographics> = Object.fromEntries(
  Object.entries(RAW).map(([id, d]) => [
    id,
    {
      medianAge: d.medianAge,
      medianIncome: dollars(d.medianIncome),
      ageSkew: d.ageSkew,
      incomeSkew: d.incomeSkew,
    },
  ]),
);

/**
 * Safe accessor. Returns the canonical demographics for the given market
 * id, falling back to a neutral default when the market isn't in the
 * overlay (useful for the v7 → v8 migration and for hypothetical future
 * markets added without entries here).
 */
export function getMarketDemographics(marketId: Id): Demographics {
  return MARKET_DEMOGRAPHICS[marketId] ?? DEFAULT_DEMOGRAPHICS;
}
