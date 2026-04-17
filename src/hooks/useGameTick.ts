"use client";

import { useEffect } from "react";

import { useGameStore } from "@/state/store";

/**
 * Wall-clock driven game loop. Mount once at the root game layout.
 * Uses setInterval at the current speed's cadence. Autosaves on every
 * in-game day boundary.
 */
export function useGameTick(): void {
  const game = useGameStore((s) => s.game);
  const tick = useGameStore((s) => s.tick);
  const intervalMs = useGameStore((s) => s.tickIntervalMs);
  const autoSave = useGameStore((s) => s.autoSave);

  useEffect(() => {
    if (!game || game.clock.speed === 0) return;
    const handle = window.setInterval(() => {
      tick();
    }, intervalMs);
    return () => window.clearInterval(handle);
  }, [game?.clock.speed, intervalMs, tick, game]);

  // Autosave every in-game day.
  useEffect(() => {
    if (!game) return;
    if (game.clock.tick % 24 === 0 && game.clock.tick > 0) {
      autoSave();
    }
  }, [game?.clock.tick, autoSave, game]);
}
