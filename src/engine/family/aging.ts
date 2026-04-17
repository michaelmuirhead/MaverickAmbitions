/**
 * Aging helpers. Called on a yearly cadence from the tick loop.
 */

import type { FamilyMember, PlayerCharacter } from "@/types/game";

export function agePlayer(player: PlayerCharacter): PlayerCharacter {
  const age = player.age + 1;
  // Health soft-declines past 50, hard-declines past 70.
  let health = player.health;
  if (age > 50) health -= 0.5;
  if (age > 70) health -= 1.5;
  health = Math.max(0, health);
  return { ...player, age, health };
}

export function ageFamilyMember(member: FamilyMember): FamilyMember {
  return { ...member, age: member.age + 1 };
}

/** Threshold at which a child becomes eligible to inherit. */
export const ADULT_AGE = 18;

/** Default natural death threshold (can be overridden by events). */
export const MAX_AGE = 100;
