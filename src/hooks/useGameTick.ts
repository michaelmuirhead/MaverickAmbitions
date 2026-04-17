import { useEffect } from "react";

import { useGameStore } from "@/state/store";

/**
 * Wall-clock driven game loop. Mount once at the root game layout.
 * Uses setInterval at the current speed's cadence. Autosaves on every
 * in-game day boundary.
 *
 * IMPORTANT: The interval effect's deps intentionally *exclude* the full
 * `game` reference. If we included it, the effect would tear down and
 * rebuild the interval on every tick — which in practice stalled the
 * clock as teardown races with the next scheduled callback. We only need
 * to restart the interval when the cadence or the tick function itself
 * changes. The `!hasGame` guard prevents the interval from running before
 * a game is loaded.
 */
export function useGameTick(): void {
  const hasGame = useGameStore((s) => s.game !== undefined);
  const speed = useGameStore((s) => s.game?.clock.speed ?? 0);
  const tickCount = useGameStore((s) => s.game?.clock.tick ?? 0);
  const tick = useGameStore((s) => s.tick);
  const intervalMs = useGameStore((s) => s.tickIntervalMs);
  const autoSave = useGameStore((s) => s.autoSave);

  useEffect(() => {
    if (!hasGame || speed === 0) return;
    const handle = window.setInterval(() => {
      tick();
    }, intervalMs);
    return () => window.clearInterval(handle);
  }, [hasGame, speed, intervalMs, tick]);

  // Autosave every in-game day.
  useEffect(() => {
    if (!hasGame) return;
    if (tickCount % 24 === 0 && tickCount > 0) {
      autoSave();
    }
  }, [hasGame, tickCount, autoSave]);
}
