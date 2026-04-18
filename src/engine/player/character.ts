/**
 * Player character factory & utilities.
 */

import { nanoid } from "nanoid";

import type { Cents, NeedMap, PlayerCharacter, SkillMap, Tick } from "@/types/game";

import { dollars } from "@/lib/money";

import { pickName } from "@/data/names";
import type { RNG } from "@/lib/rng";

/** Default starting personal cash for a new founder (v0.10.1 — was hardcoded). */
export const DEFAULT_STARTING_CASH_CENTS: Cents = dollars(15_000);

export function defaultSkills(): SkillMap {
  return {
    management: 20,
    negotiation: 20,
    finance: 20,
    charisma: 25,
    tech: 15,
    operations: 20,
  };
}

export function defaultNeeds(): NeedMap {
  return {
    sleep: 80,
    social: 60,
    family: 70,
    leisure: 50,
    status: 40,
  };
}

export function createFounder(params: {
  name?: string;
  rng: RNG;
  tick: Tick;
  startingCashCents?: Cents;
}): PlayerCharacter {
  const name = params.name ?? pickName(params.rng);
  return {
    id: nanoid(8),
    name,
    age: 24,
    health: 95,
    energy: 90,
    reputation: 0,
    skills: defaultSkills(),
    needs: defaultNeeds(),
    personalCash: params.startingCashCents ?? DEFAULT_STARTING_CASH_CENTS,
    creditScore: 660,
    personalLoans: [],
    childrenIds: [],
    parentIds: [],
    generation: 1,
    alive: true,
    birthTick: params.tick - 24 * 365 * 24, // 24 years pre-epoch
    // v0.9 — bankruptcy bookkeeping starts clean.
    personalUnsecuredDebtCents: 0,
    bankruptcyHistory: [],
    closedBusinesses: {},
  };
}

/**
 * Gently drift a character's state each in-game hour.
 */
export function onHourPlayer(
  player: PlayerCharacter,
  rng: RNG,
  _tick: Tick,
): PlayerCharacter {
  const energy = Math.max(0, player.energy - rng.nextFloat(0.2, 0.5));
  const needs: NeedMap = {
    sleep: Math.max(0, player.needs.sleep - 0.4),
    social: Math.max(0, player.needs.social - 0.2),
    family: Math.max(0, player.needs.family - 0.15),
    leisure: Math.max(0, player.needs.leisure - 0.25),
    status: player.needs.status,
  };
  return { ...player, energy, needs };
}
