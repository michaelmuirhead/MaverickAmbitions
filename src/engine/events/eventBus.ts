/**
 * Small in-memory pub/sub used by the engine to notify the UI about
 * important in-game events. Not the same as `GameEvent` records stored
 * in state — this is ephemeral (toast-style) notification.
 */

import type { GameEvent } from "@/types/game";

type Listener = (e: GameEvent) => void;

const listeners = new Set<Listener>();

export function onGameEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitGameEvent(e: GameEvent): void {
  for (const l of listeners) l(e);
}
