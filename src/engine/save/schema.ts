/**
 * Save-file schema versioning + migrations.
 *
 * Any change to `GameState` that would break older saves goes here as
 * a migration. Keeps saves portable across releases.
 */

import { nanoid } from "nanoid";

import type {
  BusinessTypeId,
  GameState,
  Id,
  MacroState,
  Market,
  Property,
  Region,
} from "@/types/game";

import { MARKET_DEMOGRAPHICS } from "@/data/marketDemographics";
import { STARTER_MARKETS } from "@/data/markets";
import { LAUNCH_REGION_ID, STARTER_REGIONS } from "@/data/regions";
import { createRng } from "@/lib/rng";

import { defaultLeversForBusinessType } from "../business/leverState";
import { generatePropertiesForMarket } from "../economy/realEstate";

export const CURRENT_SAVE_VERSION = 8;

type MigrationFn = (state: unknown) => unknown;

const MIGRATIONS: Record<number, MigrationFn> = {
  // v1 -> v2: v0.5 macro shocks. Seed empty activeEvents + eventHistory on
  // older saves so the macro event scheduler has fields to read.
  1: (s) => {
    const obj = (s as Record<string, unknown>) ?? {};
    return {
      ...obj,
      version: 2,
      activeEvents: Array.isArray(obj.activeEvents) ? obj.activeEvents : [],
      eventHistory: Array.isArray(obj.eventHistory) ? obj.eventHistory : [],
    };
  },
  // v2 -> v3: v0.5.1 small-business credit. Seed empty businessLoans map.
  2: (s) => {
    const obj = (s as Record<string, unknown>) ?? {};
    return {
      ...obj,
      version: 3,
      businessLoans:
        obj.businessLoans && typeof obj.businessLoans === "object"
          ? obj.businessLoans
          : {},
    };
  },
  // v3 -> v4: v0.7.1 expanded market roster. Merge in any new markets from
  // STARTER_MARKETS that aren't already present in the save, and seed a
  // fresh property inventory for each one so listings render on Markets.
  //
  // Existing market records (including their `businessIds` lists) are
  // preserved untouched — this migration is purely additive.
  3: (s) => {
    const obj = (s as Record<string, unknown>) ?? {};
    const seed =
      typeof obj.seed === "string" ? (obj.seed as string) : "migrate-v4";
    const rng = createRng(`${seed}:migrate:v4`);
    const markets: Record<Id, Market> = {
      ...((obj.markets as Record<Id, Market>) ?? {}),
    };
    const properties: Record<Id, Property> = {
      ...((obj.properties as Record<Id, Property>) ?? {}),
    };
    const macro =
      (obj.macro as MacroState | undefined) ??
      ({} as MacroState);

    for (const [id, market] of Object.entries(STARTER_MARKETS)) {
      if (markets[id]) continue;
      // Fresh market — copy, reset businessIds to empty just to be safe.
      markets[id] = { ...market, businessIds: [] };
      const propsForMarket = generatePropertiesForMarket(
        markets[id],
        macro,
        rng.child(`props-${id}`),
        () => nanoid(8),
      );
      for (const p of propsForMarket) {
        properties[p.id] = p;
      }
    }

    return {
      ...obj,
      version: 4,
      markets,
      properties,
    };
  },
  // v4 -> v5: v0.7.2 doubled the market roster from 22 to 46, adding
  // depth in existing bands (urban, suburban, rural, specialty) and two
  // new tiers (Coastal/Resort, Industrial/Port). Mirrors the v3 -> v4
  // approach: additive merge of any STARTER_MARKETS ids not already
  // present in the save, with a fresh property inventory seeded per new
  // market. Existing market records and property listings are preserved
  // untouched.
  4: (s) => {
    const obj = (s as Record<string, unknown>) ?? {};
    const seed =
      typeof obj.seed === "string" ? (obj.seed as string) : "migrate-v5";
    const rng = createRng(`${seed}:migrate:v5`);
    const markets: Record<Id, Market> = {
      ...((obj.markets as Record<Id, Market>) ?? {}),
    };
    const properties: Record<Id, Property> = {
      ...((obj.properties as Record<Id, Property>) ?? {}),
    };
    const macro =
      (obj.macro as MacroState | undefined) ??
      ({} as MacroState);

    for (const [id, market] of Object.entries(STARTER_MARKETS)) {
      if (markets[id]) continue;
      markets[id] = { ...market, businessIds: [] };
      const propsForMarket = generatePropertiesForMarket(
        markets[id],
        macro,
        rng.child(`props-${id}`),
        () => nanoid(8),
      );
      for (const p of propsForMarket) {
        properties[p.id] = p;
      }
    }

    return {
      ...obj,
      version: 5,
      markets,
      properties,
    };
  },
  // v5 -> v6: v0.7.3 introduces the Region model. All 46 pre-existing
  // markets are retroactively slotted into the single launch region
  // (Maverick County, NY). The migration:
  //   1. Back-fills `regionId` on every existing Market record.
  //   2. Merges any new markets from STARTER_MARKETS (none expected at
  //      v0.7.3, but keeps the additive pattern consistent) and seeds
  //      property inventory for any new ones.
  //   3. Seeds the top-level `regions` map from STARTER_REGIONS.
  //
  // Existing saves pre-dating `description` on Market don't carry one
  // through this migration; the UI falls back to the live
  // STARTER_MARKETS record when rendering a description.
  5: (s) => {
    const obj = (s as Record<string, unknown>) ?? {};
    const seed =
      typeof obj.seed === "string" ? (obj.seed as string) : "migrate-v6";
    const rng = createRng(`${seed}:migrate:v6`);
    const existingMarkets = (obj.markets as Record<Id, Market>) ?? {};
    const markets: Record<Id, Market> = {};
    const properties: Record<Id, Property> = {
      ...((obj.properties as Record<Id, Property>) ?? {}),
    };
    const macro =
      (obj.macro as MacroState | undefined) ??
      ({} as MacroState);

    // 1. Back-fill regionId on every retained market.
    for (const [id, market] of Object.entries(existingMarkets)) {
      markets[id] = {
        ...market,
        regionId: market.regionId ?? LAUNCH_REGION_ID,
      };
    }

    // 2. Additive merge for any new markets (identity operation at v0.7.3
    //    since the roster is unchanged from v5, but kept for symmetry).
    for (const [id, market] of Object.entries(STARTER_MARKETS)) {
      if (markets[id]) continue;
      markets[id] = { ...market, businessIds: [] };
      const propsForMarket = generatePropertiesForMarket(
        markets[id],
        macro,
        rng.child(`props-${id}`),
        () => nanoid(8),
      );
      for (const p of propsForMarket) {
        properties[p.id] = p;
      }
    }

    // 3. Seed regions map from STARTER_REGIONS.
    const regions: Record<Id, Region> = {
      ...((obj.regions as Record<Id, Region>) ?? {}),
    };
    for (const [id, region] of Object.entries(STARTER_REGIONS)) {
      if (!regions[id]) {
        regions[id] = { ...region };
      }
    }

    return {
      ...obj,
      version: 6,
      markets,
      regions,
      properties,
    };
  },
  // v6 -> v7: v0.9 Failure & Flow. Additive fields on existing records —
  // no data loss.
  //   1. Every Business gains `status: "operating"` + `insolvencyWeeks: 0`.
  //   2. PlayerCharacter gains `personalUnsecuredDebtCents: 0`,
  //      `bankruptcyHistory: []`, and `closedBusinesses: {}`. `bankruptcyFlag`
  //      stays undefined (no active lockout).
  //   3. GameState gains `settings: { pauseOnEvent: "blocking" }` if absent.
  //
  // Existing weekly KPI data is preserved; `peakWeeklyRevenue` stays
  // undefined until the next weekly tick re-computes it.
  6: (s) => {
    const obj = (s as Record<string, unknown>) ?? {};

    // 1. Upgrade every business with the new bankruptcy fields.
    const businesses: Record<Id, Record<string, unknown>> = {
      ...((obj.businesses as Record<Id, Record<string, unknown>>) ?? {}),
    };
    for (const bizId of Object.keys(businesses)) {
      const biz = businesses[bizId] ?? {};
      businesses[bizId] = {
        ...biz,
        status: typeof biz.status === "string" ? biz.status : "operating",
        insolvencyWeeks:
          typeof biz.insolvencyWeeks === "number" ? biz.insolvencyWeeks : 0,
      };
    }

    // 2. Upgrade the player with bankruptcy bookkeeping fields.
    const player = (obj.player as Record<string, unknown>) ?? {};
    const migratedPlayer: Record<string, unknown> = {
      ...player,
      personalUnsecuredDebtCents:
        typeof player.personalUnsecuredDebtCents === "number"
          ? player.personalUnsecuredDebtCents
          : 0,
      bankruptcyHistory: Array.isArray(player.bankruptcyHistory)
        ? player.bankruptcyHistory
        : [],
      closedBusinesses:
        player.closedBusinesses &&
        typeof player.closedBusinesses === "object" &&
        !Array.isArray(player.closedBusinesses)
          ? player.closedBusinesses
          : {},
    };

    // 3. Seed game-wide settings if absent.
    const existingSettings = (obj.settings as Record<string, unknown>) ?? {};
    const settings = {
      pauseOnEvent:
        typeof existingSettings.pauseOnEvent === "string" &&
        ["all", "blocking", "never"].includes(
          existingSettings.pauseOnEvent as string,
        )
          ? existingSettings.pauseOnEvent
          : "blocking",
    };

    return {
      ...obj,
      version: 7,
      businesses,
      player: migratedPlayer,
      settings,
    };
  },
  // v7 -> v8: v0.10 Marketing & Levers. The pre-v0.10 single
  // `marketingWeekly` / `marketingScore` scalars on every per-type state
  // blob are replaced by a shared `LeverState` on `Business.levers` with
  // a six-channel marketing map, hours schedule, signage/loyalty tiers,
  // and active-promo slot. Per the v0.10 scope decision, legacy marketing
  // spend is *not* preserved — the player restarts channel budgeting
  // from zero with the richer UI. Market demographics are also back-
  // filled from STARTER_MARKETS so the demographic-weighted channel
  // effectiveness model has data to read.
  //
  // Summary of field changes:
  //   1. Every Business gains a fresh `levers: LeverState` (retail default
  //      hours for storefronts, hospitality default for food/nightlife,
  //      24/7 for hospital/clinic, retail otherwise).
  //   2. Any legacy `state.marketingWeekly` / `state.marketingScore` keys
  //      on per-type state blobs are stripped (UI now reads from levers).
  //   3. Every Market gains `demographics` copied from MARKET_DEMOGRAPHICS
  //      (STARTER_MARKETS already carries them post-load, but saves
  //      persisted pre-migration only have the base fields).
  7: (s) => {
    const obj = (s as Record<string, unknown>) ?? {};

    // 1 + 2. Upgrade every business: strip legacy marketing scalars and
    // seed a fresh LeverState tuned for the business kind.
    const businesses: Record<Id, Record<string, unknown>> = {
      ...((obj.businesses as Record<Id, Record<string, unknown>>) ?? {}),
    };
    for (const bizId of Object.keys(businesses)) {
      const biz = businesses[bizId] ?? {};
      const rawState = (biz.state as Record<string, unknown> | undefined) ?? {};
      const {
        marketingWeekly: _legacyWeekly,
        marketingScore: _legacyScore,
        ...cleanState
      } = rawState;
      void _legacyWeekly;
      void _legacyScore;
      businesses[bizId] = {
        ...biz,
        state: cleanState,
        levers:
          biz.levers ??
          defaultLeversForBusinessType(biz.type as BusinessTypeId),
      };
    }

    // 3. Back-fill market demographics on every retained market.
    const existingMarkets = (obj.markets as Record<Id, Market>) ?? {};
    const markets: Record<Id, Market> = {};
    for (const [id, market] of Object.entries(existingMarkets)) {
      markets[id] = {
        ...market,
        demographics: market.demographics ?? MARKET_DEMOGRAPHICS[id],
      };
    }

    return {
      ...obj,
      version: 8,
      businesses,
      markets,
    };
  },
};


export function migrateSave(raw: unknown): GameState {
  const obj = raw as { version?: number };
  let version = obj.version ?? 0;
  let working: unknown = raw;
  while (version < CURRENT_SAVE_VERSION) {
    const mig = MIGRATIONS[version];
    if (!mig) {
      throw new Error(
        `No migration from save version ${version} to ${CURRENT_SAVE_VERSION}.`,
      );
    }
    working = mig(working);
    version++;
  }
  return working as GameState;
}
