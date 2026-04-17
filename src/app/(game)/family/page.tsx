"use client";

import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";

import { useGameStore } from "@/state/store";
import { formatMoney } from "@/lib/money";

export default function FamilyPage() {
  const game = useGameStore((s) => s.game)!;
  const p = game.player;
  const family = Object.values(game.family);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Family</h1>
        <p className="text-ink-400 text-sm mt-1">
          You are generation {p.generation}. Your choices echo forward — heirs
          inherit your wealth, your reputation, and your rivalries.
        </p>
      </header>

      <Card title="You" subtitle={`${p.name} · age ${p.age}`}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile label="Health" value={p.health.toFixed(0)} />
          <StatTile label="Energy" value={p.energy.toFixed(0)} />
          <StatTile label="Reputation" value={p.reputation.toFixed(0)} />
          <StatTile label="Credit" value={p.creditScore.toFixed(0)} />
        </div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mt-4 mb-2">
          Skills
        </h4>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
          {Object.entries(p.skills).map(([k, v]) => (
            <li key={k} className="flex items-center justify-between">
              <span className="text-ink-300 capitalize">{k}</span>
              <span className="font-mono tabular-nums">{v.toFixed(0)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Household"
        subtitle={p.spouseId ? "Married" : "Single"}
      >
        {family.length === 0 ? (
          <p className="text-sm text-ink-400">
            You&apos;re on your own. You&apos;ll be able to date, marry, and start a
            family in a later update.
          </p>
        ) : (
          <ul className="divide-y divide-ink-800">
            {family.map((m) => (
              <li key={m.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-ink-400">
                    {m.role} · age {m.age}
                  </div>
                </div>
                <div className="text-xs text-ink-400">
                  Affinity {m.affinity.toFixed(0)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Dynasty" subtitle={`Generation ${game.dynasty.generations}`}>
        <div className="grid grid-cols-2 gap-2">
          <StatTile
            label="Cumulative net worth"
            value={formatMoney(game.dynasty.cumulativeNetWorth, { compact: true })}
          />
          <StatTile
            label="Influence"
            value={game.dynasty.influence}
          />
          <StatTile
            label="Philanthropy"
            value={formatMoney(game.dynasty.philanthropy, { compact: true })}
          />
          <StatTile
            label="Heirs in waiting"
            value={p.childrenIds.length}
          />
        </div>
      </Card>
    </div>
  );
}
