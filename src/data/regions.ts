/**
 * Regions — the geographic containers for Markets.
 *
 * v0.7.3 ships the first playable Region, **Maverick County, NY** — a
 * fictional booming county on the outskirts of New York City. It contains
 * all 46 starter markets: the Manhattan-style downtown, the Westchester /
 * Nassau-flavored suburbs, a Long Island-adjacent coastal strip, a
 * Catskills-adjacent upstate pocket, and a NY Harbor-flavored industrial
 * belt.
 *
 * This file is intentionally thin right now. The architecture exists so
 * that later versions can extend the map without refactoring:
 *
 *   • Phase 2 (mid-roadmap) — add neighboring regions: NYC boroughs
 *     (Manhattan, Brooklyn, Queens, Bronx, Staten Island), Long Island
 *     (Nassau / Suffolk), and New Jersey (Hudson, Bergen, Essex).
 *   • Phase 3 (late-roadmap) — add major US metros (Los Angeles County,
 *     Cook County IL, Miami-Dade, Harris TX, Fulton GA, etc.), each
 *     carrying its own market roster and unlocking region-scoped mechanics
 *     such as sports-team ownership and political office.
 *
 * When new regions ship, each new entry is added here with its
 * `marketIds` and `active` flag. The Market records themselves point
 * back to a region via `Market.regionId`. Until a region is `active`,
 * the MarketPage UI hides its markets from the grid.
 */

import type { Id, Region } from "@/types/game";

export const LAUNCH_REGION_ID: Id = "r_maverick_county_ny";

export const STARTER_REGIONS: Record<Id, Region> = {
  [LAUNCH_REGION_ID]: {
    id: LAUNCH_REGION_ID,
    name: "Maverick County, NY",
    country: "US",
    tagline: "A booming county on the outskirts of New York City.",
    summary:
      "Maverick County sits just across the bridges from New York City, " +
      "a fictional 46-neighborhood county that mixes a mini-Manhattan " +
      "downtown, Westchester-style inner suburbs, a Long Island-adjacent " +
      "coastal strip, a Catskills-adjacent upstate pocket, and a working " +
      "harbor and rail-freight belt. Every archetype the game's systems " +
      "model — gentrifying arts districts, old-money enclaves, declining " +
      "mill towns, gated-community summit neighborhoods, a convention " +
      "plaza, a medical district, a university strip — fits inside the " +
      "county's borders. Phase 2 will add NYC proper, Long Island, and " +
      "New Jersey; Phase 3 opens up the rest of the country.",
    // Keep in sync with STARTER_MARKETS in src/data/markets.ts. The order
    // matches the archetype-band grouping in that file.
    marketIds: [
      // Central city (4)
      "m_downtown",
      "m_riverside",
      "m_oak_hills",
      "m_southside",
      // Greater metro urban (12)
      "m_midtown",
      "m_warehouse_district",
      "m_university_heights",
      "m_harborview",
      "m_silverlake",
      "m_old_town",
      "m_arts_district",
      "m_little_portugal",
      "m_chinatown",
      "m_garment_district",
      "m_theater_district",
      "m_financial_district",
      // Suburbs (10)
      "m_cedar_park",
      "m_willow_creek",
      "m_pine_ridge",
      "m_elmwood",
      "m_briar_glen",
      "m_maple_grove",
      "m_hillcrest",
      "m_fairview_heights",
      "m_tanglewood",
      "m_summit_ridge",
      // Outlying / rural (8)
      "m_meadowbrook",
      "m_fort_hayward",
      "m_junction_town",
      "m_cypress_falls",
      "m_stonebrook",
      "m_copper_valley",
      "m_willow_bend",
      "m_pineview",
      // Specialty commercial (5)
      "m_tech_park",
      "m_medical_district",
      "m_airport_commons",
      "m_convention_plaza",
      "m_campus_commons",
      // Coastal / resort (4)
      "m_seacliff",
      "m_marlin_harbor",
      "m_sandy_point",
      "m_bayshore_marina",
      // Industrial / port (3)
      "m_rust_belt",
      "m_harbor_works",
      "m_rail_yard",
    ],
    active: true,
  },
};
