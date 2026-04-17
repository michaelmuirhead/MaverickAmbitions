import { Card } from "@/components/ui/Card";

import { useGameStore } from "@/state/store";
import { selectRivalsLeaderboard } from "@/state/selectors";
import { formatMoney } from "@/lib/money";

const PERSONALITY_LABEL: Record<string, string> = {
  predator: "Predator · acquires aggressively",
  tycoon: "Tycoon · diversifies",
  operator: "Operator · margin-obsessed",
  disruptor: "Disruptor · price wars",
  politician: "Politician · influence plays",
};

export function RivalsPage() {
  const game = useGameStore((s) => s.game)!;
  const leaderboard = selectRivalsLeaderboard(game);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Rivals</h1>
        <p className="text-ink-400 text-sm mt-1">
          AI rivals play by the same rules you do. Their P&L is real. They can
          go broke. They will take your territory if you blink.
        </p>
      </header>

      <Card title="Leaderboard">
        <ol className="divide-y divide-ink-800">
          {leaderboard.map((r, idx) => {
            const rival = game.rivals[r.id]!;
            return (
              <li key={r.id} className="py-3 flex items-start gap-3">
                <div className="text-ink-400 w-5 text-right font-mono tabular-nums">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{r.name}</span>
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-ink-800 text-ink-300">
                      L{rival.difficulty}
                    </span>
                  </div>
                  <div className="text-xs text-ink-400">
                    {PERSONALITY_LABEL[rival.personality] ?? rival.personality}
                  </div>
                  <div className="text-xs text-ink-500 mt-1 truncate">
                    {r.lastMove}
                  </div>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <div className="font-semibold">
                    {formatMoney(r.netWorth, { compact: true })}
                  </div>
                  <div className="text-[11px] text-ink-400">
                    {r.businesses} biz
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
