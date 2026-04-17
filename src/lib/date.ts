/**
 * In-game calendar helpers.
 *
 * Base rule: 1 tick = 1 in-game hour. The game starts at GAME_EPOCH.
 * The real-world date is irrelevant — we present in-game date only.
 */

import { addHours, format, getDay, getHours, startOfDay } from "date-fns";

import type { Tick } from "@/types/game";

export const GAME_EPOCH = new Date(2026, 0, 5, 8, 0, 0); // Mon Jan 5 2026, 08:00

export function tickToDate(tick: Tick): Date {
  return addHours(GAME_EPOCH, tick);
}

export function formatGameDate(
  tick: Tick,
  fmt: "short" | "long" | "time" = "short",
): string {
  const d = tickToDate(tick);
  switch (fmt) {
    case "short":
      return format(d, "EEE MMM d, yyyy · h:mm a");
    case "long":
      return format(d, "EEEE, MMMM d, yyyy · h:mm a");
    case "time":
      return format(d, "h:mm a");
  }
}

export function isNightHour(tick: Tick): boolean {
  const h = getHours(tickToDate(tick));
  return h >= 22 || h < 6;
}

export function isBusinessHour(tick: Tick): boolean {
  const h = getHours(tickToDate(tick));
  return h >= 7 && h < 22;
}

export function dayOfWeek(tick: Tick): number {
  return getDay(tickToDate(tick));
}

export function isWeekend(tick: Tick): boolean {
  const d = dayOfWeek(tick);
  return d === 0 || d === 6;
}

export function startOfDayTick(tick: Tick): Tick {
  const d = tickToDate(tick);
  const ms = startOfDay(d).getTime() - GAME_EPOCH.getTime();
  return Math.floor(ms / (1000 * 60 * 60));
}

/** Useful derived units. */
export const HOURS_PER_DAY = 24;
export const HOURS_PER_WEEK = 24 * 7;
export const HOURS_PER_MONTH = 24 * 30;
export const HOURS_PER_YEAR = 24 * 365;
