/**
 * Master tick loop. Pure function: (state) -> state'.
 *
 * 1 tick = 1 in-game hour.
 *
 * Each tick runs:
 *   - advance macro state
 *   - per-business onHour
 *   - hourly player drift
 *   - daily roll-ups (on hour == 0)
 *   - weekly roll-ups (on Monday 00:00)
 *   - weekly rival AI step
 *   - random events roll
 */

import { nanoid } from "nanoid";

import type {
  Business,
  GameEvent,
  GameState,
  LedgerEntry,
  Tick,
} from "@/types/game";

import {
  HOURS_PER_YEAR,
  dayOfWeek,
  tickToDate,
} from "@/lib/date";
import { createRng } from "@/lib/rng";

import { getBusinessModule } from "./business/registry";
import { advanceMacro } from "./economy/cycles";
import { ECONOMY } from "./economy/constants";
import { resetYearlyMissedPayments, runMonthlySettlement } from "./economy/realEstate";
import { runMonthlyBusinessLoanPayments } from "./economy/businessLoan";
import { emitGameEvent } from "./events/eventBus";
import { rollRandomEvent } from "./events/randomEvents";
import { agePlayer, ageFamilyMember, MAX_AGE } from "./family/aging";
import { applySuccession } from "./family/inheritance";
import {
  applyMacroPulses,
  expireFinishedEvents,
  rollWeeklyMacroEvent,
} from "./macro/events";
import { onHourPlayer } from "./player/character";
import { stepRivalWeekly } from "./ai/rival";

/** Approximated in-game month (30 days × 24 hours). */
const HOURS_PER_MONTH = 24 * 30;

/**
 * Advance the game by a single tick. Deterministic given (state, rng).
 */
export function stepTick(state: GameState): GameState {
  const tick = state.clock.tick + 1;
  const rootRng = createRng(`${state.seed}#${tick}`);

  // 1. Macro — advance the cycle, then expire finished shocks and apply
  // active-event pulses so business modules see the post-pulse macro.
  const cycleHours = lerp(
    ECONOMY.MACRO_CYCLE_HOURS_MIN,
    ECONOMY.MACRO_CYCLE_HOURS_MAX,
    0.5,
  );
  const baselineMacro = advanceMacro(state.macro, 1, cycleHours);

  // 1a. Expire any shocks whose endTick has passed (frees up cooldown slots).
  const expiry = expireFinishedEvents(state, tick);
  let activeEvents = expiry.activeEvents;
  const eventHistory = expiry.eventHistory;

  // 1b. Apply pulse composition over the baseline macro.
  const macro = applyMacroPulses(baselineMacro, activeEvents);

  // 2. Businesses — hourly.
  let businesses: Record<string, Business> = { ...state.businesses };
  let ledger: LedgerEntry[] = appendLedger(state.ledger, expiry.ledger);
  let events: GameEvent[] = appendGameEvents(state.events, expiry.gameEvents);
  // Mutable real-estate slices — rivals may buy during the weekly block,
  // and the monthly settlement revalues everything.
  let rivalsState = state.rivals;
  let properties = state.properties;
  let mortgages = state.mortgages;
  let businessLoans = state.businessLoans ?? {};

  const worldSnapshot: GameState = {
    ...state,
    macro,
    clock: { ...state.clock, tick },
    activeEvents,
    eventHistory,
  };

  for (const biz of Object.values(state.businesses)) {
    const mod = tryGetModule(biz.type);
    if (!mod) continue;
    const { business: updated, ledger: addLedger, events: addEvents } = mod.onHour(
      biz,
      {
        tick,
        macro,
        rng: rootRng.child(`biz-hour-${biz.id}`),
        world: worldSnapshot,
      },
    );
    businesses[biz.id] = updated;
    ledger = appendLedger(ledger, addLedger);
    events = appendBusinessEvents(events, addEvents, tick, biz.id);
  }

  // 3. Player hourly drift.
  const player = onHourPlayer(state.player, rootRng.child("player-hour"), tick);

  // 4. Daily & weekly roll-ups based on clock boundaries.
  const date = tickToDate(tick);
  const atDayStart = date.getHours() === 0;
  const atWeekStart = atDayStart && dayOfWeek(tick) === 1; // Monday
  const atMonthBoundary = tick > 0 && tick % HOURS_PER_MONTH === 0;
  const atYearBoundary = tick % HOURS_PER_YEAR === 0;

  if (atDayStart) {
    for (const biz of Object.values(businesses)) {
      const mod = tryGetModule(biz.type);
      if (!mod) continue;
      const {
        business: updated,
        ledger: addLedger,
        events: addEvents,
      } = mod.onDay(biz, {
        tick,
        macro,
        rng: rootRng.child(`biz-day-${biz.id}`),
        world: worldSnapshot,
      });
      businesses[biz.id] = updated;
      ledger = appendLedger(ledger, addLedger);
      events = appendBusinessEvents(events, addEvents, tick, biz.id);
    }
    // Random event rolls per business.
    for (const biz of Object.values(businesses)) {
      if (rootRng.chance(ECONOMY.DAILY_EVENT_CHANCE)) {
        const e = rollRandomEvent(rootRng.child(`event-${biz.id}`), tick);
        if (e) {
          events = [...events, e];
          emitGameEvent(e);
          if (e.impact?.cashDelta) {
            businesses[biz.id] = {
              ...biz,
              cash: biz.cash + e.impact.cashDelta,
            };
          }
        }
      }
    }
  }

  // 5. Weekly: businesses + rivals.
  if (atWeekStart) {
    for (const biz of Object.values(businesses)) {
      const mod = tryGetModule(biz.type);
      if (!mod) continue;
      const {
        business: updated,
        ledger: addLedger,
        events: addEvents,
      } = mod.onWeek(biz, {
        tick,
        macro,
        rng: rootRng.child(`biz-week-${biz.id}`),
        world: worldSnapshot,
      });
      businesses[biz.id] = updated;
      ledger = appendLedger(ledger, addLedger);
      events = appendBusinessEvents(events, addEvents, tick, biz.id);
    }

    // Weekly macro event roll — possibly schedule a new shock. We do this
    // before rival decisions so rivals see the new event this same week.
    const roll = rollWeeklyMacroEvent(
      { ...state, activeEvents, eventHistory },
      tick,
      rootRng.child("macro-event-roll"),
    );
    if (roll?.active) {
      activeEvents = [...activeEvents, roll.active];
      ledger = appendLedger(ledger, roll.ledger);
      events = appendGameEvents(events, roll.gameEvents);
      for (const e of roll.gameEvents) emitGameEvent(e);
    }

    // Rival moves.
    let workingState: GameState = {
      ...state,
      clock: { ...state.clock, tick },
      macro,
      businesses,
      rivals: rivalsState,
      properties,
      mortgages,
      ledger,
      events,
      player,
      activeEvents,
      eventHistory,
    };
    for (const rival of Object.values(workingState.rivals)) {
      const frag = stepRivalWeekly(
        rival,
        workingState,
        tick,
        rootRng.child(`rival-${rival.id}`),
      );
      workingState = { ...workingState, ...frag };
    }
    businesses = workingState.businesses;
    rivalsState = workingState.rivals;
    properties = workingState.properties;
    mortgages = workingState.mortgages;
  }

  // 5b. Monthly settlement — mortgages, property maintenance, absentee rent,
  // revaluation. Approximate month = 720 ticks.
  let monthlyPlayer = player;
  if (atMonthBoundary) {
    const working: GameState = {
      ...state,
      clock: { ...state.clock, tick },
      macro,
      player,
      businesses,
      rivals: rivalsState,
      properties,
      mortgages,
      ledger,
      events,
      activeEvents,
      eventHistory,
    };
    const { state: afterMonth, ledger: monthLedger } = runMonthlySettlement(
      working,
      tick,
      rootRng.child("monthly"),
    );
    monthlyPlayer = afterMonth.player;
    rivalsState = afterMonth.rivals;
    properties = afterMonth.properties;
    mortgages = afterMonth.mortgages;
    businesses = afterMonth.businesses;
    ledger = appendLedger(ledger, monthLedger);

    // 5c. Business-loan settlement — pay this month's installment on every
    // outstanding player business loan. Draws biz cash first, personal as
    // fallback. Missed → credit ding, balance untouched for retry next month.
    const workingAfterRE: GameState = {
      ...working,
      player: monthlyPlayer,
      businesses,
      rivals: rivalsState,
      properties,
      mortgages,
      businessLoans,
    };
    const bLoanRes = runMonthlyBusinessLoanPayments(workingAfterRE, tick);
    monthlyPlayer = bLoanRes.player;
    businesses = bLoanRes.businesses;
    businessLoans = bLoanRes.businessLoans;
    ledger = appendLedger(ledger, bLoanRes.ledger);
  }

  // 6. Yearly: age everyone.
  let nextPlayer = monthlyPlayer;
  let nextFamily = state.family;
  if (atYearBoundary && tick > 0) {
    nextPlayer = agePlayer(nextPlayer);
    const aged: typeof state.family = {};
    for (const id of Object.keys(nextFamily)) {
      aged[id] = ageFamilyMember(nextFamily[id]!);
    }
    nextFamily = aged;
  }

  // 7. Succession check.
  let finalState: GameState = {
    ...state,
    clock: { ...state.clock, tick, lastStepAt: Date.now() },
    macro,
    player: nextPlayer,
    family: nextFamily,
    businesses,
    rivals: rivalsState,
    properties,
    mortgages,
    businessLoans,
    ledger: ledger.slice(-5000), // cap ledger to last 5k entries for MVP
    events: events.slice(-200), // cap in-memory events
    activeEvents,
    eventHistory,
  };

  // Reset per-year counters once per year.
  if (atYearBoundary && tick > 0) {
    finalState = resetYearlyMissedPayments(finalState);
  }

  if (!finalState.player.alive || finalState.player.age >= MAX_AGE) {
    const { state: afterSuccession } = applySuccession(
      finalState,
      rootRng.child("succession"),
    );
    finalState = afterSuccession;
  }

  return finalState;
}

// ---------- helpers ----------

function tryGetModule(type: Business["type"]) {
  try {
    return getBusinessModule(type);
  } catch {
    return undefined;
  }
}

function appendLedger(base: LedgerEntry[], add: LedgerEntry[]): LedgerEntry[] {
  if (add.length === 0) return base;
  return [...base, ...add];
}

function appendGameEvents(base: GameEvent[], add: GameEvent[]): GameEvent[] {
  if (add.length === 0) return base;
  return [...base, ...add];
}

function appendBusinessEvents(
  base: GameEvent[],
  add: ReturnType<ReturnType<typeof getBusinessModule>["onHour"]>["events"],
  tick: Tick,
  _bizId: string,
): GameEvent[] {
  if (add.length === 0) return base;
  const next: GameEvent[] = [...base];
  for (const a of add) {
    next.push({
      id: nanoid(6),
      tick,
      kind: a.kind,
      title: a.title,
      detail: a.detail,
      impact: a.impact,
      dismissed: false,
    });
  }
  return next;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
