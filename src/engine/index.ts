/**
 * Engine entrypoint — initial game state + top-level step.
 */

import { nanoid } from "nanoid";

import type { GameState, Id, MacroState, Property } from "@/types/game";

import { STARTER_MARKETS } from "@/data/markets";
import { STARTER_REGIONS } from "@/data/regions";
import { createRng } from "@/lib/rng";

import { createRival } from "./ai/rival";
import { initialMacroState } from "./economy/cycles";
import { generatePropertiesForMarket } from "./economy/realEstate";
import { createFounder } from "./player/character";

export { stepTick } from "./tick";
export { advanceUntil } from "./advance";
export type { AdvanceTarget, AdvanceStop, AdvanceResult } from "./advance";
export { saveGame, loadGame, listSaves, deleteSave, AUTOSAVE_SLOT } from "./save/saveGame";
export { getBusinessModule, getAvailableBusinessTypes } from "./business/registry";

export interface NewGameOptions {
  founderName?: string;
  seed?: string;
  difficulty?: 1 | 2 | 3 | 4 | 5;
}

export function newGame(opts: NewGameOptions = {}): GameState {
  const seed = opts.seed ?? nanoid(8);
  const rng = createRng(seed);
  const founder = createFounder({ name: opts.founderName, rng: rng.child("founder"), tick: 0 });
  const macro: MacroState = initialMacroState();

  const markets = { ...STARTER_MARKETS };
  const regions = { ...STARTER_REGIONS };

  const difficulty = opts.difficulty ?? 3;
  const operator = createRival({
    personality: "operator",
    difficulty,
    rng: rng.child("rival-1"),
    name: "Dunhill Holdings",
  });
  const disruptor = createRival({
    personality: "disruptor",
    difficulty,
    rng: rng.child("rival-2"),
    name: "Kestrel Discount",
  });
  const rivals = {
    [operator.id]: operator,
    [disruptor.id]: disruptor,
  };

  // Seed a starter property inventory for each market. All listings start
  // absentee-owned (no ownerId) until a player or rival buys one.
  const properties: Record<Id, Property> = {};
  for (const market of Object.values(markets)) {
    const propsForMarket = generatePropertiesForMarket(
      market,
      macro,
      rng.child(`props-${market.id}`),
      () => nanoid(8),
    );
    for (const p of propsForMarket) {
      properties[p.id] = p;
    }
  }

  return {
    version: 7,
    seed,
    clock: { tick: 0, lastStepAt: Date.now(), speed: 1 },
    macro,
    player: founder,
    family: {},
    businesses: {},
    markets,
    regions,
    rivals,
    properties,
    mortgages: {},
    businessLoans: {},
    ledger: [],
    events: [],
    activeEvents: [],
    eventHistory: [],
    dynasty: {
      generations: 1,
      cumulativeNetWorth: 0,
      philanthropy: 0,
      influence: 0,
    },
    // v0.9 — default fast-forward pause behavior.
    settings: {
      pauseOnEvent: "blocking",
    },
  };
}
