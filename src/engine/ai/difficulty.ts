/**
 * Difficulty curves. Higher difficulty = faster decision cadence,
 * better utility estimation, bigger starting capital, and tighter
 * error (less random noise on move scoring).
 */

export interface DifficultyProfile {
  weeklyMovesPerRival: number;
  /** Stddev of random noise added to utility scores (lower = sharper AI). */
  decisionNoise: number;
  /** Starting capital multiplier. */
  startingCapitalMultiplier: number;
  /** Percent extra margin efficiency vs. player. */
  efficiencyBonus: number;
}

export const DIFFICULTY: Record<1 | 2 | 3 | 4 | 5, DifficultyProfile> = {
  1: {
    weeklyMovesPerRival: 0.3,
    decisionNoise: 0.9,
    startingCapitalMultiplier: 0.7,
    efficiencyBonus: 0,
  },
  2: {
    weeklyMovesPerRival: 0.6,
    decisionNoise: 0.7,
    startingCapitalMultiplier: 0.9,
    efficiencyBonus: 0.02,
  },
  3: {
    weeklyMovesPerRival: 1.0,
    decisionNoise: 0.4,
    startingCapitalMultiplier: 1.0,
    efficiencyBonus: 0.05,
  },
  4: {
    weeklyMovesPerRival: 1.4,
    decisionNoise: 0.25,
    startingCapitalMultiplier: 1.2,
    efficiencyBonus: 0.08,
  },
  5: {
    weeklyMovesPerRival: 2.0,
    decisionNoise: 0.1,
    startingCapitalMultiplier: 1.6,
    efficiencyBonus: 0.12,
  },
};
