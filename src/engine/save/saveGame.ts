/**
 * Save / load. MVP uses browser localStorage. Cloud save (Supabase,
 * Postgres) can plug into the same interface later.
 */

import type { GameState } from "@/types/game";

import { CURRENT_SAVE_VERSION, migrateSave } from "./schema";

const KEY_PREFIX = "maverick-ambitions:save:";

export function listSaves(): string[] {
  if (typeof window === "undefined") return [];
  const slots: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(KEY_PREFIX)) slots.push(k.slice(KEY_PREFIX.length));
  }
  return slots.sort();
}

export function saveGame(slot: string, state: GameState): void {
  if (typeof window === "undefined") return;
  const payload = { ...state, version: CURRENT_SAVE_VERSION };
  window.localStorage.setItem(KEY_PREFIX + slot, JSON.stringify(payload));
}

export function loadGame(slot: string): GameState | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(KEY_PREFIX + slot);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return migrateSave(parsed);
  } catch (err) {
    console.error("Failed to load save", slot, err);
    return undefined;
  }
}

export function deleteSave(slot: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY_PREFIX + slot);
}

export const AUTOSAVE_SLOT = "autosave";
