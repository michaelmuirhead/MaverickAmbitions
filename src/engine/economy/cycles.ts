/**
 * Macroeconomic cycle simulation.
 *
 * A single `phaseProgress ∈ [0, 1)` slides through five phases in order:
 *   recovery → expansion → peak → contraction → trough → (recovery again)
 *
 * From that, we derive consumer wallet, interest rate, real estate, and
 * labor cost multipliers. This is intentionally simple — rival AI reads
 * the same values, so both sides play by the same rules.
 */

import type { MacroPhase, MacroState } from "@/types/game";

import { ECONOMY } from "./constants";

const PHASE_ORDER: MacroPhase[] = [
  "recovery",
  "expansion",
  "peak",
  "contraction",
  "trough",
];

export function initialMacroState(): MacroState {
  return {
    phase: "recovery",
    phaseProgress: 0,
    interestRate: 0.045,
    consumerWallet: 1.0,
    realEstateMultiplier: 1.0,
    laborCostMultiplier: 1.0,
  };
}

/**
 * Advance the macro state by `hours`. Called from the tick loop each step.
 */
export function advanceMacro(
  macro: MacroState,
  hours: number,
  cycleLengthHours: number,
): MacroState {
  const totalPhases = PHASE_ORDER.length;
  const perPhaseHours = cycleLengthHours / totalPhases;
  const currentIdx = PHASE_ORDER.indexOf(macro.phase);
  let localProgress = macro.phaseProgress + hours / perPhaseHours;
  let phaseIdx = currentIdx;
  while (localProgress >= 1) {
    localProgress -= 1;
    phaseIdx = (phaseIdx + 1) % totalPhases;
  }
  const phase = PHASE_ORDER[phaseIdx]!;

  // Phase-wise signal: a sinusoid across the full cycle, mapped to [-1, 1].
  const globalProgress =
    (phaseIdx + localProgress) / totalPhases; // 0..1 across full cycle
  const signal = Math.sin(globalProgress * Math.PI * 2); // -1..1

  const consumerWallet = lerp(
    ECONOMY.CONSUMER_WALLET_MIN,
    ECONOMY.CONSUMER_WALLET_MAX,
    (signal + 1) / 2,
  );

  // Interest rate lags consumer wallet by ~90 degrees (phaseProgress + 0.25)
  const rateSignal = Math.sin((globalProgress + 0.25) * Math.PI * 2);
  const interestRate = lerp(
    ECONOMY.INTEREST_RATE_MIN,
    ECONOMY.INTEREST_RATE_MAX,
    (rateSignal + 1) / 2,
  );

  // Real estate drifts with a slow smoothing factor.
  const targetRE = lerp(0.75, 1.6, (signal + 1) / 2);
  const realEstateMultiplier =
    macro.realEstateMultiplier + (targetRE - macro.realEstateMultiplier) * 0.02;

  // Labor cost is sticky — moves only upward except in deep trough.
  const laborCostMultiplier = Math.max(
    macro.laborCostMultiplier,
    lerp(0.95, 1.25, (signal + 1) / 2),
  );

  return {
    phase,
    phaseProgress: localProgress,
    consumerWallet,
    interestRate,
    realEstateMultiplier,
    laborCostMultiplier,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
