/**
 * Fast-forward helper (v0.9 Failure & Flow).
 *
 * Wraps `stepTick` in a bounded loop that stops on one of:
 *   - a target clock boundary is reached (day / week start)
 *   - a new game event that should pause the burst appears
 *   - a hard tick cap is hit (safety)
 *   - the player record dies and hasn't been re-seated by succession
 *
 * The "event" target stops on the first qualifying new event regardless
 * of clock position; pauseOnEvent="never" still trips it on blocking
 * events so the button behaves like the player expects (they clicked
 * "advance until the next thing to look at").
 *
 * Day / Week bursts consult `settings.pauseOnEvent` verbatim:
 *   "all"      — any new event halts
 *   "blocking" — only events with `blocking: true` halt (default)
 *   "never"    — events never halt; only the clock target or the cap
 */
import type { GameEvent, GameSettings, GameState, Tick } from "@/types/game";
import { HOURS_PER_DAY, HOURS_PER_WEEK, dayOfWeek, tickToDate } from "@/lib/date";

import { stepTick } from "./tick";

export type AdvanceTarget = "day" | "week" | "event";
export type AdvanceStop = "target" | "event" | "maxTicks" | "dead";

export interface AdvanceResult {
  state: GameState;
  ticksAdvanced: number;
  stoppedOn: AdvanceStop;
}

/**
 * Safety caps. The loop is O(ticks) so a huge cap is fine — these just
 * prevent an infinite spin if a stop condition never fires.
 */
const DEFAULT_CAPS: Record<AdvanceTarget, number> = {
  day: HOURS_PER_DAY,
  week: HOURS_PER_WEEK,
  // One in-game month upper bound for "advance until something happens".
  event: HOURS_PER_DAY * 30,
};

export function advanceUntil(
  state: GameState,
  target: AdvanceTarget,
  maxTicks?: number,
): AdvanceResult {
  const cap = Math.max(1, maxTicks ?? DEFAULT_CAPS[target]);
  const pauseMode = state.settings?.pauseOnEvent ?? "blocking";

  let cur = state;
  let ticksAdvanced = 0;

  while (ticksAdvanced < cap) {
    const prevLen = cur.events.length;
    const prevPlayerId = cur.player.id;
    cur = stepTick(cur);
    ticksAdvanced++;

    // Clock-based stop conditions.
    if (target === "day" && atDayStart(cur.clock.tick)) {
      return { state: cur, ticksAdvanced, stoppedOn: "target" };
    }
    if (target === "week" && atWeekStart(cur.clock.tick)) {
      return { state: cur, ticksAdvanced, stoppedOn: "target" };
    }

    // Event-based stop condition. For "day"/"week" targets this honors
    // the configured pauseOnEvent; for the explicit "event" target we
    // treat "never" as if the user picked "blocking" — they clicked a
    // button that exists specifically to pause on events.
    const effectiveMode: GameSettings["pauseOnEvent"] =
      target === "event" && pauseMode === "never" ? "blocking" : pauseMode;
    if (effectiveMode !== "never") {
      const halt = firstQualifyingNewEvent(cur.events, prevLen, effectiveMode);
      if (halt) {
        return { state: cur, ticksAdvanced, stoppedOn: "event" };
      }
    }

    // Player died and succession didn't re-seat — bail out so the UI
    // can render the terminal screen.
    if (!cur.player.alive && cur.player.id === prevPlayerId) {
      return { state: cur, ticksAdvanced, stoppedOn: "dead" };
    }
  }

  return { state: cur, ticksAdvanced, stoppedOn: "maxTicks" };
}

/** True when `tick` is the start of a day (hour 00). */
function atDayStart(tick: Tick): boolean {
  return tickToDate(tick).getHours() === 0;
}

/** True when `tick` is Monday 00:00. */
function atWeekStart(tick: Tick): boolean {
  return atDayStart(tick) && dayOfWeek(tick) === 1;
}

/**
 * Return the first post-step event that should halt a fast-forward, or
 * undefined if nothing qualifies.
 */
function firstQualifyingNewEvent(
  events: GameEvent[],
  prevLen: number,
  mode: "all" | "blocking",
): GameEvent | undefined {
  // The master loop caps `events` to the last N entries, so `prevLen`
  // can exceed the current length after a step. Start from the safe
  // minimum to avoid scanning pre-existing events.
  const start = Math.min(prevLen, events.length);
  for (let i = start; i < events.length; i++) {
    const e = events[i]!;
    if (e.dismissed) continue;
    if (mode === "all") return e;
    if (mode === "blocking" && e.blocking) return e;
  }
  return undefined;
}
