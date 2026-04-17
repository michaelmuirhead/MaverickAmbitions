/**
 * Rival personality archetypes. Personalities weight the utility
 * function used by the rival strategy layer when scoring moves.
 */

import type { RivalPersonality } from "@/types/game";

export interface PersonalityProfile {
  aggression: number; // 0..1
  riskAppetite: number; // 0..1
  patience: number; // 0..1
  priceWarBias: number; // 0..1
  acquisitionBias: number; // 0..1
  lobbyingBias: number; // 0..1 (political influence)
  ethics: number; // 0..1 (higher = cleaner play)
}

export const PERSONALITIES: Record<RivalPersonality, PersonalityProfile> = {
  predator: {
    aggression: 0.9,
    riskAppetite: 0.8,
    patience: 0.2,
    priceWarBias: 0.7,
    acquisitionBias: 0.8,
    lobbyingBias: 0.2,
    ethics: 0.35,
  },
  tycoon: {
    aggression: 0.6,
    riskAppetite: 0.7,
    patience: 0.5,
    priceWarBias: 0.3,
    acquisitionBias: 0.9,
    lobbyingBias: 0.4,
    ethics: 0.55,
  },
  operator: {
    aggression: 0.4,
    riskAppetite: 0.4,
    patience: 0.8,
    priceWarBias: 0.2,
    acquisitionBias: 0.3,
    lobbyingBias: 0.2,
    ethics: 0.8,
  },
  disruptor: {
    aggression: 0.8,
    riskAppetite: 0.7,
    patience: 0.3,
    priceWarBias: 0.9,
    acquisitionBias: 0.2,
    lobbyingBias: 0.1,
    ethics: 0.55,
  },
  politician: {
    aggression: 0.5,
    riskAppetite: 0.4,
    patience: 0.7,
    priceWarBias: 0.2,
    acquisitionBias: 0.4,
    lobbyingBias: 0.95,
    ethics: 0.5,
  },
};
