/**
 * Marriage, children, and affinity mechanics.
 *
 * Not fully wired into the MVP UI yet, but the data model is here and
 * the functions are pure so they're easy to unit test.
 */

import { nanoid } from "nanoid";

import type { FamilyMember, Id, PlayerCharacter } from "@/types/game";

import { pickName } from "@/data/names";
import type { RNG } from "@/lib/rng";

export function marry(
  player: PlayerCharacter,
  spouseName: string | undefined,
  rng: RNG,
): { player: PlayerCharacter; spouse: FamilyMember } {
  const spouse: FamilyMember = {
    id: nanoid(8),
    name: spouseName ?? pickName(rng),
    age: Math.max(20, player.age + rng.nextInt(-4, 4)),
    role: "spouse",
    traits: {
      charisma: rng.nextInt(20, 80),
      management: rng.nextInt(10, 70),
      finance: rng.nextInt(10, 70),
    },
    affinity: 75,
    alive: true,
  };
  return { player: { ...player, spouseId: spouse.id }, spouse };
}

export function divorce(
  player: PlayerCharacter,
): PlayerCharacter {
  if (!player.spouseId) return player;
  return { ...player, spouseId: undefined };
}

export function adjustAffinity(member: FamilyMember, delta: number): FamilyMember {
  return {
    ...member,
    affinity: Math.max(-100, Math.min(100, member.affinity + delta)),
  };
}

export function canHaveChild(player: PlayerCharacter, spouse: FamilyMember): boolean {
  return player.alive && spouse.alive && player.age >= 18 && player.age <= 55;
}

export function conceiveChild(
  parents: { player: PlayerCharacter; spouse: FamilyMember },
  rng: RNG,
): FamilyMember {
  const inheritedCharisma =
    ((parents.player.skills.charisma + (parents.spouse.traits.charisma ?? 40)) / 2) +
    rng.nextFloat(-10, 10);
  const inheritedMgmt =
    ((parents.player.skills.management + (parents.spouse.traits.management ?? 30)) / 2) +
    rng.nextFloat(-10, 10);
  return {
    id: nanoid(8),
    name: pickName(rng),
    age: 0,
    role: "child",
    traits: {
      charisma: Math.max(0, Math.min(100, Math.round(inheritedCharisma))),
      management: Math.max(0, Math.min(100, Math.round(inheritedMgmt))),
    },
    affinity: 80,
    alive: true,
  };
}

export function linkChildToPlayer(
  player: PlayerCharacter,
  childId: Id,
): PlayerCharacter {
  return { ...player, childrenIds: [...player.childrenIds, childId] };
}
