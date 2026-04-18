import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";

import { useGameStore } from "@/state/store";

/**
 * Landing / splash page. Auto-redirects to /dashboard if a save exists.
 */
export function HomePage() {
  const navigate = useNavigate();
  const loadSlot = useGameStore((s) => s.loadSlot);

  useEffect(() => {
    const ok = loadSlot();
    if (ok) navigate("/dashboard", { replace: true });
  }, [loadSlot, navigate]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="max-w-md">
        <div className="text-accent text-sm font-semibold uppercase tracking-[0.2em] mb-2">
          Maverick
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-ink-50">
          Ambitions
        </h1>
        <p className="mt-4 text-ink-300 text-sm sm:text-base leading-relaxed">
          Maverick County, NY — a booming county on the outskirts of New York
          City. Start with a single corner store. Build an empire across
          industries. Marry, raise heirs, outlast your rivals — across
          generations.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/new-game" className="contents">
            <Button size="lg">New Game</Button>
          </Link>
          <Link to="/dashboard" className="contents">
            <Button size="lg" variant="secondary">
              Continue
            </Button>
          </Link>
        </div>
        <p className="mt-8 text-xs text-ink-500">
          v0.8.1 — Maverick County, NY
        </p>
      </div>
    </main>
  );
}
