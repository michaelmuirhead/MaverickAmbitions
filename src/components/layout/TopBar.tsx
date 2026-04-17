import { useGameStore } from "@/state/store";
import { selectNetWorth } from "@/state/selectors";
import { formatGameDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";

import { Button } from "@/components/ui/Button";

import { cn } from "@/lib/cn";

/**
 * Top bar with the in-game date, net worth, and speed controls.
 * Responsive: condensed on phone, expanded on iPad/Desktop.
 */
export function TopBar({ bucket }: { bucket: "phone" | "tablet" | "desktop" }) {
  const game = useGameStore((s) => s.game);
  const setSpeed = useGameStore((s) => s.setSpeed);

  if (!game) return null;
  const netWorth = selectNetWorth(game);
  const date = formatGameDate(game.clock.tick, bucket === "phone" ? "short" : "long");

  return (
    <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
      <div
        className={cn(
          "flex items-center gap-2 sm:gap-4 px-3 sm:px-6 py-2",
          bucket !== "phone" && "h-14",
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
