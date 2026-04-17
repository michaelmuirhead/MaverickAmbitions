/**
 * Personal "needs" — sleep, social, family, leisure, status — balance
 * the fantasy of empire-building with being a human. Unmet needs cap
 * energy, morale, and eventually reputation.
 */

import type { NeedMap, PlayerCharacter } from "@/types/game";

export function totalStrain(needs: NeedMap): number {
  const values = Object.values(needs);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.max(0, 100 - avg);
}

/** Apply a chosen rest/activity that restores one or more needs. */
export function doPersonalActivity(
  player: PlayerCharacter,
  delta: Partial<NeedMap>,
  energyDelta = 0,
): PlayerCharacter {
  const needs: NeedMap = {
    sleep: Math.max(0, Math.min(100, player.needs.sleep + (delta.sleep ?? 0))),
    social: Math.max(0, Math.min(100, player.needs.social + (delta.social ?? 0))),
    family: Math.max(0, Math.min(100, player.needs.family + (delta.family ?? 0))),
    leisure: Math.max(0, Math.min(100, player.needs.leisure + (delta.leisure ?? 0))),
    status: Math.max(0, Math.min(100, player.needs.status + (delta.status ?? 0))),
  };
  const energy = Math.max(0, Math.min(100, player.energy + energyDelta));
  return { ...player, needs, energy };
}
