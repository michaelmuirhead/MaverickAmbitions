import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

import { useGameStore } from "@/state/store";

export function NewGamePage() {
  const startNew = useGameStore((s) => s.startNew);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4 | 5>(3);

  return (
    <main className="min-h-screen px-4 py-10 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-ink-50 mb-1">New Game</h1>
      <p className="text-ink-400 text-sm mb-6">
        You are 24. You have $15,000 to your name and a feeling you are meant
        for more.
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
      </Card>
      <div className="mt-6 flex gap-3">
        <Button
          size="lg"
          onClick={() => {
            startNew({ founderName: name || undefined, difficulty });
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
