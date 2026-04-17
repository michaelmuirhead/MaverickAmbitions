/**
 * Macro event scheduler + pulse application (v0.5).
 *
 * Three public entry points:
 *
 *   1. `rollWeeklyMacroEvent(state, tick, rng)` — called once per week
 *      from the tick loop. Possibly schedules a new ActiveMacroEvent
 *      and returns markers the caller should append to state.
 *
 *   2. `expireFinishedEvents(state, tick)` — removes any ActiveMacroEvent
 *      whose `endTick <= tick` and writes it to `eventHistory`. Returns
 *      expiry GameEvents + ledger markers.
 *
 *   3. `applyMacroPulses(macro, activeEvents)` — called every tick on
 *      the post-cycle macro before it's handed to business modules.
 *      Additive/multiplicative composition: rate delta is summed,
 *      multipliers are multiplied.
 *
 * The sim also calls `getPulseBundle(activeEvents)` to read the
 * non-macro pulse fields (cogsMul, trafficMulByType, etc.) since those
 * don't live on MacroState.
 */

import { nanoid } from "nanoid";

import type {
  ActiveMacroEvent,
  BusinessTypeId,
  GameEvent,
  GameState,
  LedgerEntry,
  MacroEventDef,
  MacroEventId,
  MacroState,
  Tick,
} from "@/types/game";

import { MACRO_EVENTS, MACRO_EVENTS_BY_ID } from "@/data/macroEvents";
import type { RNG } from "@/lib/rng";

const WEEKLY_ROLL_CHANCE = 0.08;
const MAX_SIMULTANEOUS_EVENTS = 3;
const EVENT_HISTORY_CAP = 32;

// ---------- Scheduling ----------

/**
 * Called on the weekly tick boundary. Returns any newly-scheduled event
 * (with marker ledger + GameEvent entries) or undefined if nothing fired.
 */
export function rollWeeklyMacroEvent(
  state: GameState,
  tick: Tick,
  rng: RNG,
): {
  active?: ActiveMacroEvent;
  gameEvents: GameEvent[];
  ledger: LedgerEntry[];
} | undefined {
  if ((state.activeEvents?.length ?? 0) >= MAX_SIMULTANEOUS_EVENTS) {
    return undefined;
  }
  if (!rng.chance(WEEKLY_ROLL_CHANCE)) return undefined;

  // Filter out events on cooldown or already active.
  const activeIds = new Set((state.activeEvents ?? []).map((a) => a.defId));
  const eligible = MACRO_EVENTS.filter((def) => {
    if (activeIds.has(def.id)) return false;
    return !isOnCooldown(state, def, tick);
  });
  if (eligible.length === 0) return undefined;

  const def = rng.pickWeighted(
    eligible,
    eligible.map((e) => e.weight),
  );
  const active: ActiveMacroEvent = {
    id: nanoid(6),
    defId: def.id,
    startTick: tick,
    endTick: tick + def.durationTicks,
  };

  const gameEvent: GameEvent = {
    id: nanoid(6),
    tick,
    kind: "macro_shock",
    title: def.title,
    detail: def.detail,
    dismissed: false,
  };

  const ledgerEntry: LedgerEntry = {
    id: nanoid(6),
    tick,
    amount: 0,
    category: "event_marker",
    memo: `Macro event started — ${def.title}`,
  };

  return {
    active,
    gameEvents: [gameEvent],
    ledger: [ledgerEntry],
  };
}

function isOnCooldown(
  state: GameState,
  def: MacroEventDef,
  tick: Tick,
): boolean {
  const history = state.eventHistory ?? [];
  for (const h of history) {
    if (h.defId !== def.id) continue;
    if (tick - h.endTick < def.cooldownTicks) return true;
  }
  return false;
}

// ---------- Expiry ----------

/**
 * Expire any events whose endTick has passed. Returns new arrays to assign
 * onto state, plus GameEvents / ledger markers describing the expiry.
 */
export function expireFinishedEvents(
  state: GameState,
  tick: Tick,
): {
  activeEvents: ActiveMacroEvent[];
  eventHistory: GameState["eventHistory"];
  gameEvents: GameEvent[];
  ledger: LedgerEntry[];
} {
  const active = state.activeEvents ?? [];
  const history = state.eventHistory ?? [];
  const stillActive: ActiveMacroEvent[] = [];
  const newHistory = [...history];
  const gameEvents: GameEvent[] = [];
  const ledger: LedgerEntry[] = [];

  for (const a of active) {
    if (a.endTick > tick) {
      stillActive.push(a);
      continue;
    }
    const def = MACRO_EVENTS_BY_ID[a.defId];
    newHistory.push({
      defId: a.defId,
      startTick: a.startTick,
      endTick: a.endTick,
    });
    if (def) {
      gameEvents.push({
        id: nanoid(6),
        tick,
        kind: "macro_shock_end",
        title: `${def.title} ended`,
        detail: `Pulse cleared. Macro signals returning to baseline.`,
        dismissed: false,
      });
      ledger.push({
        id: nanoid(6),
        tick,
        amount: 0,
        category: "event_marker",
        memo: `Macro event ended — ${def.title}`,
      });
    }
  }

  return {
    activeEvents: stillActive,
    eventHistory: newHistory.slice(-EVENT_HISTORY_CAP),
    gameEvents,
    ledger,
  };
}

// ---------- Pulse application ----------

/**
 * Compose active-event pulses into the macro signals. Call this every
 * tick AFTER `advanceMacro`.
 *
 *   interestRate     — additive (sum of deltas)
 *   consumerWallet   — multiplicative (product of muls)
 *   realEstateMul    — multiplicative
 *   laborCostMul     — multiplicative
 *
 * Bounds: interestRate clamped to [0.005, 0.20]; multipliers to [0.5, 2.0].
 */
export function applyMacroPulses(
  macro: MacroState,
  activeEvents: ActiveMacroEvent[],
): MacroState {
  if (activeEvents.length === 0) return macro;

  let rateDelta = 0;
  let walletMul = 1;
  let reMul = 1;
  let laborMul = 1;

  for (const a of activeEvents) {
    const def = MACRO_EVENTS_BY_ID[a.defId];
    if (!def) continue;
    const p = def.pulse;
    if (p.interestRateDelta) rateDelta += p.interestRateDelta;
    if (p.consumerWalletMul) walletMul *= p.consumerWalletMul;
    if (p.realEstateMul) reMul *= p.realEstateMul;
    if (p.laborCostMul) laborMul *= p.laborCostMul;
  }

  return {
    ...macro,
    interestRate: clamp(macro.interestRate + rateDelta, 0.005, 0.2),
    consumerWallet: clamp(macro.consumerWallet * walletMul, 0.5, 2.0),
    realEstateMultiplier: clamp(macro.realEstateMultiplier * reMul, 0.5, 2.0),
    laborCostMultiplier: clamp(macro.laborCostMultiplier * laborMul, 0.5, 2.0),
  };
}

// ---------- Non-macro pulse bundle ----------

/**
 * Bundle of event-derived multipliers that don't live on MacroState.
 * The sim reads these directly at the points they apply (cogs in onHour,
 * traffic in business type's demand model, etc.).
 */
export interface MacroPulseBundle {
  cogsMultiplier: number;
  liquorLicenseFeeMultiplier: number;
  trafficMultiplierByType: Partial<Record<BusinessTypeId, number>>;
}

export function getPulseBundle(
  activeEvents: ActiveMacroEvent[],
): MacroPulseBundle {
  let cogs = 1;
  let liquorFee = 1;
  const traffic: Partial<Record<BusinessTypeId, number>> = {};

  for (const a of activeEvents) {
    const def = MACRO_EVENTS_BY_ID[a.defId];
    if (!def) continue;
    const p = def.pulse;
    if (p.cogsMul) cogs *= p.cogsMul;
    if (p.liquorLicenseFeeMul) liquorFee *= p.liquorLicenseFeeMul;
    if (p.trafficMulByType) {
      for (const [type, mul] of Object.entries(p.trafficMulByType)) {
        const key = type as BusinessTypeId;
        traffic[key] = (traffic[key] ?? 1) * (mul ?? 1);
      }
    }
  }

  return {
    cogsMultiplier: cogs,
    liquorLicenseFeeMultiplier: liquorFee,
    trafficMultiplierByType: traffic,
  };
}

// ---------- UI helpers ----------

export interface EventBanner {
  id: string;
  defId: MacroEventId;
  title: string;
  detail: string;
  tone: "positive" | "negative" | "mixed";
  severity: "mild" | "strong";
  ticksRemaining: number;
  weeksRemaining: number;
}

export function getEventBanners(
  state: GameState,
  tick: Tick,
): EventBanner[] {
  const active = state.activeEvents ?? [];
  const banners: EventBanner[] = [];
  for (const a of active) {
    const def = MACRO_EVENTS_BY_ID[a.defId];
    if (!def) continue;
    const ticksRemaining = Math.max(0, a.endTick - tick);
    banners.push({
      id: a.id,
      defId: a.defId,
      title: def.title,
      detail: def.detail,
      tone: def.tone,
      severity: def.severity,
      ticksRemaining,
      weeksRemaining: Math.ceil(ticksRemaining / (24 * 7)),
    });
  }
  // Most severe first, then most recent.
  banners.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "strong" ? -1 : 1;
    return b.ticksRemaining - a.ticksRemaining;
  });
  return banners;
}

// ---------- Test / debug helpers ----------

/**
 * Force-activate an event. Used by smoke tests and by the debug console
 * to reproduce specific scenarios deterministically.
 */
export function forceActivate(
  state: GameState,
  defId: MacroEventId,
  tick: Tick,
): {
  active: ActiveMacroEvent;
  gameEvent: GameEvent;
  ledger: LedgerEntry;
} {
  const def = MACRO_EVENTS_BY_ID[defId];
  if (!def) throw new Error(`Unknown macro event: ${defId}`);
  void state; // state intentionally unused — force-activate bypasses gating.
  const active: ActiveMacroEvent = {
    id: nanoid(6),
    defId,
    startTick: tick,
    endTick: tick + def.durationTicks,
    note: "forced",
  };
  return {
    active,
    gameEvent: {
      id: nanoid(6),
      tick,
      kind: "macro_shock",
      title: def.title,
      detail: def.detail,
      dismissed: false,
    },
    ledger: {
      id: nanoid(6),
      tick,
      amount: 0,
      category: "event_marker",
      memo: `Macro event forced — ${def.title}`,
    },
  };
}

// ---------- internal ----------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
