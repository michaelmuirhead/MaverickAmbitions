import type { PlayerCharacter, SkillMap } from "@/types/game";

export type SkillKey = keyof SkillMap;

export function addSkillXp(
  player: PlayerCharacter,
  skill: SkillKey,
  xp: number,
): PlayerCharacter {
  const nextValue = Math.min(100, player.skills[skill] + xp);
  return {
    ...player,
    skills: { ...player.skills, [skill]: nextValue },
  };
}

/** Utility that translates a skill value into a 0..1 effectiveness. */
export function skillEffectiveness(value: number): number {
  // S-curve — early gains feel meaningful, late gains taper.
  const x = value / 100;
  return 1 / (1 + Math.exp(-8 * (x - 0.5)));
}
