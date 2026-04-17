import type { PlayerCharacter } from "@/types/game";

export function nudgeReputation(
  player: PlayerCharacter,
  delta: number,
): PlayerCharacter {
  const reputation = Math.max(-100, Math.min(100, player.reputation + delta));
  return { ...player, reputation };
}
