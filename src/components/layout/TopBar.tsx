import { useGameStore } from "@/state/store";
import { selectNetWorth } from "@/state/selectors";
import { formatGameDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";

import { Button } from "@/components/ui/Button";

import { cn } from "@/lib/cn";

/**
 * Top bar with the in-game date, net worth, speed controls, and
 * v0.9 fast-forward shortcuts (Day ▸ / Week ▸ / Event ▸).
 * Responsive: condensed on phone, expanded on iPad/Desktop.
 *
 * Fast-forward buttons run the engine synchronously up to the next
 * clock boundary (day start / Monday 00:00) or a qualifying new event
 * per `settings.pauseOnEvent`, then pause the clock so the player can
 * review the result.
 */
export function TopBar({ bucket }: { bucket: "phone" | "tablet" | "desktop" }) {
  const game = useGameStore((s) => s.game);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const advanceUntil = useGameStore((s) => s.advanceUntil);

  if (!game) return null;
  const netWorth = selectNetWorth(game);
  const date = formatGameDate(game.clock.tick, bucket === "phone" ? "short" : "long");
  const phone = bucket === "phone";

  return (
    <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
      <div
        className={cn(
          "flex items-center gap-2 sm:gap-4 px-3 sm:px-6 py-2",
          !phone && "h-14",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[11px] sm:text-xs uppercase tracking-wide text-ink-400 font-medium">
            {date}
          </div>
          <div className="text-sm sm:text-base font-semibold text-ink-50 truncate font-mono tabular-nums">
            Net worth {formatMoney(netWorth, { compact: true })}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Fast-forward bursts. Hidden on phone to keep the bar light;
              phones still get the full set via SettingsPage → Debug or
              the dedicated speed buttons. */}
          {!phone && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => advanceUntil("day")}
                title="Advance to the next day start"
                aria-label="Advance to next day"
                className="!min-h-0 h-8 px-2"
              >
                Day ▸
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => advanceUntil("week")}
                title="Advance to next Monday 00:00"
                aria-label="Advance to next week"
                className="!min-h-0 h-8 px-2"
              >
                Week ▸
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => advanceUntil("event")}
                title="Advance until the next notable event (up to one month)"
                aria-label="Advance to next event"
                className="!min-h-0 h-8 px-2"
              >
                Event ▸
              </Button>
              <span className="mx-1 h-5 w-px bg-ink-800" aria-hidden />
            </>
          )}
          {([0, 1, 2, 4, 8] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={game.clock.speed === s ? "primary" : "ghost"}
              onClick={() => setSpeed(s)}
              aria-label={`Speed ${s}x`}
              className="!min-h-0 h-8 w-10 px-0"
            >
              {s === 0 ? "II" : `${s}×`}
            </Button>
          ))}
        </div>
      </div>
    </header>
  );
}
