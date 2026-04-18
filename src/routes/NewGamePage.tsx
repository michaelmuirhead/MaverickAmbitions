import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

import { useGameStore } from "@/state/store";
import { formatMoney } from "@/lib/money";

// v0.10.1: starting-cash slider bounds. $1k steps from $5k (lean start —
// no runway) to $50k (silver-spoon start — can cover the corner-store
// startup and still have ops cash). Default sits at $15k, matching the
// previous hardcoded founder cash.
const STARTING_CASH_MIN_DOLLARS = 5_000;
const STARTING_CASH_MAX_DOLLARS = 50_000;
const STARTING_CASH_STEP_DOLLARS = 1_000;
const STARTING_CASH_DEFAULT_DOLLARS = 15_000;

export function NewGamePage() {
  const startNew = useGameStore((s) => s.startNew);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [startingCashDollars, setStartingCashDollars] = useState<number>(
    STARTING_CASH_DEFAULT_DOLLARS,
  );
  const startingCashCents = startingCashDollars * 100;

  return (
    <main className="min-h-screen px-4 py-10 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-ink-50 mb-1">New Game</h1>
      <p className="text-ink-400 text-sm mb-6">
        You are 24, newly arrived in Maverick County, NY — a booming county on
        the outskirts of New York City. You have {formatMoney(startingCashCents)} to your name
        and a feeling you are meant for more.
      </p>
      <Card title="Founder">
        <label className="block text-xs text-ink-400 mb-2 mt-1">
          Your name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Alex Muirhead"
          className="w-full rounded-xl bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-500 outline-none focus:border-accent"
        />

        <label className="block text-xs text-ink-400 mt-4 mb-2">
          Difficulty
        </label>
        <div className="grid grid-cols-5 gap-2">
          {([1, 2, 3, 4, 5] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDifficulty(d)}
              className={
                "rounded-xl py-2 text-sm font-medium border " +
                (difficulty === d
                  ? "bg-accent text-ink-950 border-accent"
                  : "bg-ink-800 border-ink-700 text-ink-200 hover:bg-ink-700")
              }
            >
              {d}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-400 leading-snug">
          {difficulty === 1 && "Intern: rivals rarely expand."}
          {difficulty === 2 && "Manager: rivals react to you."}
          {difficulty === 3 && "Operator: rivals are proactive."}
          {difficulty === 4 && "Tycoon: aggressive, well-capitalized rivals."}
          {difficulty === 5 && "Kingmaker: coordinated rivals. They will ruin you."}
        </p>

        <div className="mt-4 flex items-baseline justify-between">
          <label htmlFor="starting-cash" className="text-xs text-ink-400">
            Starting cash
          </label>
          <span className="text-sm font-semibold text-ink-50 font-mono tabular-nums">
            {formatMoney(startingCashCents)}
          </span>
        </div>
        <input
          id="starting-cash"
          type="range"
          min={STARTING_CASH_MIN_DOLLARS}
          max={STARTING_CASH_MAX_DOLLARS}
          step={STARTING_CASH_STEP_DOLLARS}
          value={startingCashDollars}
          onChange={(e) => setStartingCashDollars(Number(e.target.value))}
          className="w-full mt-2 accent-accent"
          aria-label="Starting cash"
        />
        <div className="mt-1 flex justify-between text-[10px] text-ink-500 font-mono tabular-nums">
          <span>${STARTING_CASH_MIN_DOLLARS.toLocaleString()}</span>
          <span>${STARTING_CASH_MAX_DOLLARS.toLocaleString()}</span>
        </div>
        <p className="mt-2 text-xs text-ink-400 leading-snug">
          {startingCashDollars <= 7_000 &&
            "Lean start: you can't cover a corner-store buildout without a loan."}
          {startingCashDollars > 7_000 &&
            startingCashDollars < 20_000 &&
            "Classic start: enough to take a real swing at your first business."}
          {startingCashDollars >= 20_000 &&
            startingCashDollars < 35_000 &&
            "Comfortable start: startup capital plus operating runway."}
          {startingCashDollars >= 35_000 &&
            "Silver spoon: you can open and still have meaningful reserves."}
        </p>
      </Card>
      <div className="mt-6 flex gap-3">
        <Button
          size="lg"
          onClick={() => {
            startNew({
              founderName: name || undefined,
              difficulty,
              startingCashCents,
            });
            navigate("/dashboard", { replace: true });
          }}
        >
          Begin
        </Button>
        <Button
          size="lg"
          variant="ghost"
          onClick={() => navigate(-1)}
        >
          Cancel
        </Button>
      </div>
    </main>
  );
}
