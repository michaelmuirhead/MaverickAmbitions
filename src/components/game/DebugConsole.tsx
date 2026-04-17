import { useState } from "react";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

import { useGameStore } from "@/state/store";
import { selectMacroBanners } from "@/state/selectors";
import { MACRO_EVENTS } from "@/data/macroEvents";

/**
 * v0.5 debug console.
 *
 * Force-activate any macro shock at the current tick to reproduce a
 * specific scenario deterministically. This is developer UX — there's no
 * intent to hide it from curious players, but it deliberately lives on
 * Settings rather than the main dashboard.
 *
 * Active shocks are listed with their weeks-remaining. A clear button
 * wipes `activeEvents` (useful when the RNG hands you a shock you didn't
 * want in the middle of a demo).
 */
export function DebugConsole() {
  const game = useGameStore((s) => s.game);
  const force = useGameStore((s) => s.debugForceMacroEvent);
  const clear = useGameStore((s) => s.debugClearMacroEvents);
  const banners = game ? selectMacroBanners(game) : [];
  const [open, setOpen] = useState(false);

  if (!game) return null;

  return (
    <Card
      title="Debug console"
      subtitle="Developer tools — force macro shocks, inspect pulses"
      trailing={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide" : "Show"}
        </Button>
      }
    >
      {!open ? (
        <p className="text-xs text-ink-400">
          {banners.length === 0
            ? "No active shocks."
            : `${banners.length} active shock${banners.length === 1 ? "" : "s"}.`}
        </p>
      ) : (
        <div className="space-y-4">
          <section>
            <header className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                Force macro shock
              </h4>
              <span className="text-[11px] font-mono tabular-nums text-ink-400">
                tick {game.clock.tick}
              </span>
            </header>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MACRO_EVENTS.map((def) => (
                <button
                  key={def.id}
                  onClick={() => force(def.id)}
                  className="text-left rounded-lg border border-ink-800 bg-ink-950/40 px-3 py-2 hover:border-ink-600 hover:bg-ink-900 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink-50 truncate">
                      {def.title}
                    </span>
                    <span
                      className={[
                        "text-[10px] uppercase font-mono tracking-wider shrink-0",
                        def.tone === "positive"
                          ? "text-emerald-400"
                          : def.tone === "negative"
                            ? "text-amber-400"
                            : "text-ink-400",
                      ].join(" ")}
                    >
                      {def.severity}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-400 mt-0.5 leading-snug line-clamp-2">
                    {def.detail}
                  </p>
                </button>
              ))}
            </div>
          </section>

          <section>
            <header className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                Active shocks
              </h4>
              {banners.length > 0 && (
                <Button size="sm" variant="ghost" onClick={clear}>
                  Clear all
                </Button>
              )}
            </header>
            {banners.length === 0 ? (
              <p className="text-xs text-ink-500">None. Force one above.</p>
            ) : (
              <ul className="space-y-1.5">
                {banners.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between text-xs font-mono tabular-nums text-ink-300 border-l-2 border-ink-700 pl-2"
                  >
                    <span className="truncate">{b.title}</span>
                    <span className="text-ink-500">{b.weeksRemaining}w</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Card>
  );
}
