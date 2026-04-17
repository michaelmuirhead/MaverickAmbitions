import { Link } from "react-router-dom";

import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { Button } from "@/components/ui/Button";
import { ContentGrid } from "@/components/layout/ContentGrid";
import { EventBanner } from "@/components/game/EventBanner";
import { EventsFeed } from "@/components/game/EventsFeed";
import { WealthBreakdownCard } from "@/components/game/WealthBreakdownCard";

import { useGameStore } from "@/state/store";
import {
  selectActiveEvents,
  selectMacroBanners,
  selectPlayerBusinesses,
  selectPlayerProperties,
  selectRivalsLeaderboard,
  selectWealthBreakdown,
  selectWeeklyPL,
} from "@/state/selectors";
import { formatMoney } from "@/lib/money";

export function DashboardPage() {
  const game = useGameStore((s) => s.game)!;
  const wealth = selectWealthBreakdown(game);
  const pl = selectWeeklyPL(game);
  const events = selectActiveEvents(game);
  const macroBanners = selectMacroBanners(game);
  const rivals = selectRivalsLeaderboard(game);
  const bizs = selectPlayerBusinesses(game);
  const props = selectPlayerProperties(game);

  return (
    <div className="space-y-4 sm:space-y-6">
      <header>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
          Good {timeOfDayGreeting(game.clock.tick)}, {firstName(game.player.name)}.
        </h1>
        <p className="text-ink-400 text-sm mt-1">
          Generation {game.player.generation} · Age {game.player.age} · {game.macro.phase}
        </p>
      </header>

      <EventBanner banners={macroBanners} />

      <ContentGrid>
        <StatTile
          label="Net worth"
          value={formatMoney(wealth.netWorth, { compact: true })}
          hint={`Personal ${formatMoney(wealth.personalCash, { compact: true })}`}
        />
        <StatTile
          label="Weekly P&L"
          value={formatMoney(pl.profit, { compact: true, sign: true })}
          delta={pl.revenue > 0 ? (pl.profit / pl.revenue) * 100 : 0}
          hint={`Revenue ${formatMoney(pl.revenue, { compact: true })}`}
        />
        <StatTile
          label="Credit score"
          value={game.player.creditScore}
          hint={`Interest ${(game.macro.interestRate * 100).toFixed(2)}%`}
        />
        <StatTile
          label="Reputation"
          value={game.player.reputation}
          hint={`Dynasty gen ${game.dynasty.generations}`}
        />
      </ContentGrid>

      <WealthBreakdownCard
        breakdown={wealth}
        businessCount={bizs.length}
        propertyCount={props.length}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card
          title="Your businesses"
          subtitle={`${bizs.length} active`}
          trailing={
            <Link to="/business">
              <Button size="sm" variant="secondary">
                Manage
              </Button>
            </Link>
          }
          className="lg:col-span-2"
        >
          {bizs.length === 0 ? (
            <EmptyBusinesses />
          ) : (
            <ul className="divide-y divide-ink-800 -mx-1">
              {bizs.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between py-3 px-1"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-ink-50 truncate">
                      {b.name}
                    </div>
                    <div className="text-xs text-ink-400">
                      {game.markets[b.locationId]?.name ?? "—"} · Cash{" "}
                      {formatMoney(b.cash, { compact: true })}
                    </div>
                  </div>
                  <div className="text-right font-mono text-sm tabular-nums">
                    <div
                      className={
                        b.kpis.weeklyProfit >= 0 ? "text-money" : "text-loss"
                      }
                    >
                      {formatMoney(b.kpis.weeklyProfit, { compact: true, sign: true })}
                    </div>
                    <div className="text-[11px] text-ink-400">
                      CSAT {b.kpis.customerSatisfaction.toFixed(0)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Rivals">
          <ul className="space-y-3">
            {rivals.map((r) => (
              <li key={r.id} className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="font-mono text-sm tabular-nums text-ink-200">
                    {formatMoney(r.netWorth, { compact: true })}
                  </div>
                </div>
                <div className="text-xs text-ink-400 truncate">{r.lastMove}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Recent activity" subtitle="Grouped by kind · filter by severity">
        <EventsFeed events={events} />
      </Card>
    </div>
  );
}

function EmptyBusinesses() {
  return (
    <div className="text-sm text-ink-400">
      You have no businesses yet.{" "}
      <Link to="/market" className="text-accent underline underline-offset-2">
        Find a market
      </Link>{" "}
      and open your first store.
    </div>
  );
}

function firstName(full: string): string {
  return full.split(" ")[0] ?? full;
}

function timeOfDayGreeting(tick: number): string {
  const h = ((tick % 24) + 24) % 24;
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
