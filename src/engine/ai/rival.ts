/**
 * Rival lifecycle — create, step, and compute net worth.
 */

import { nanoid } from "nanoid";

import type { AIRival, GameState, RivalPersonality, Tick } from "@/types/game";

import { dollars } from "@/lib/money";
import { pickName } from "@/data/names";
import type { RNG } from "@/lib/rng";

import { DIFFICULTY } from "./difficulty";
import { applyMove, chooseMove } from "./strategy";

export function createRival(params: {
  personality: RivalPersonality;
  difficulty: 1 | 2 | 3 | 4 | 5;
  rng: RNG;
  name?: string;
}): AIRival {
  const base = dollars(50_000);
  const diff = DIFFICULTY[params.difficulty];
  return {
    id: nanoid(8),
    name: params.name ?? `${pickName(params.rng)} Enterprises`,
    personality: params.personality,
    difficulty: params.difficulty,
    netWorth: Math.round(base * diff.startingCapitalMultiplier),
    businessIds: [],
    stance: 0,
  };
}

/**
 * Advance a rival one weekly step. Returns new state fragments to merge.
 */
export function stepRivalWeekly(
  rival: AIRival,
  state: GameState,
  tick: Tick,
  rng: RNG,
): Partial<GameState> {
  const diff = DIFFICULTY[rival.difficulty];
  const movesThisWeek =
    Math.floor(diff.weeklyMovesPerRival) +
    (rng.chance(diff.weeklyMovesPerRival % 1) ? 1 : 0);

  let working: GameState = state;
  let lastDescription = "";
  for (let i = 0; i < movesThisWeek; i++) {
    const currentRival = working.rivals[rival.id] ?? rival;
    const move = chooseMove(currentRival, working, rng.child(`move-${i}`));
    const delta = applyMove(currentRival, move, working, tick, rng.child(`apply-${i}`));
    const {
      lastMove,
      ...rest
    } = delta;
    working = {
      ...working,
      ...rest,
    };
    const updated: AIRival = {
      ...(working.rivals[rival.id] ?? rival),
      lastMove,
    };
    working = {
      ...working,
      rivals: { ...working.rivals, [rival.id]: updated },
    };
    if (lastMove?.description) lastDescription = lastMove.description;
  }

  void lastDescription;
  return {
    rivals: working.rivals,
    businesses: working.businesses,
    markets: working.markets,
    properties: working.properties,
    mortgages: working.mortgages,
  };
}
