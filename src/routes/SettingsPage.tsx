import { useNavigate } from "react-router-dom";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DebugConsole } from "@/components/game/DebugConsole";

import { useGameStore } from "@/state/store";

import { AUTOSAVE_SLOT, deleteSave, listSaves, saveGame } from "@/engine";

export function SettingsPage() {
  const game = useGameStore((s) => s.game)!;
  const navigate = useNavigate();

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card title="Save">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => saveGame(AUTOSAVE_SLOT, game)}
          >
            Save now
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const slot = prompt("Name this save slot", "slot-1");
              if (slot) saveGame(slot, game);
            }}
          >
            Save as…
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm("Delete all saves? This cannot be undone.")) {
                for (const s of listSaves()) deleteSave(s);
                navigate("/", { replace: true });
              }
            }}
          >
            Delete saves
          </Button>
        </div>
        <ul className="mt-4 text-sm text-ink-300">
          {listSaves().map((s) => (
            <li key={s} className="font-mono text-xs text-ink-400 py-0.5">
              {s}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Game">
        <div className="text-sm text-ink-300 space-y-2">
          <div>Seed: <span className="font-mono">{game.seed}</span></div>
          <div>Version: <span className="font-mono">{game.version}</span></div>
          <div>Tick: <span className="font-mono">{game.clock.tick}</span></div>
        </div>
      </Card>

      <DebugConsole />

      <Card title="About">
        <p className="text-sm text-ink-300 leading-relaxed">
          <strong>Maverick Ambitions</strong> is a generational business
          simulation. You start as a 24-year-old with $15,000 and build an
          empire that outlasts you. This is v0.6 — Vite + HashRouter, SBA
          business loans. See DESIGN.md in the repo for what ships next.
        </p>
      </Card>
    </div>
  );
}
