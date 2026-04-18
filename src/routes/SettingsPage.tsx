import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DebugConsole } from "@/components/game/DebugConsole";
import { Tutorial, resetTutorialSeen } from "@/components/game/Tutorial";

import { useGameStore } from "@/state/store";
import { cn } from "@/lib/cn";

import type { GameSettings } from "@/types/game";
import { AUTOSAVE_SLOT, deleteSave, listSaves, saveGame } from "@/engine";

export function SettingsPage() {
  const game = useGameStore((s) => s.game)!;
  const navigate = useNavigate();
  const [tutorialOpen, setTutorialOpen] = useState(false);

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

      <FastForwardCard />

      <Card title="Tutorial" subtitle="Replay the 7-step intro to the core loop.">
        <Button
          variant="secondary"
          onClick={() => {
            resetTutorialSeen();
            setTutorialOpen(true);
          }}
        >
          Replay tutorial
        </Button>
        <Tutorial
          open={tutorialOpen}
          onClose={() => setTutorialOpen(false)}
        />
      </Card>

      <DebugConsole />

      {/* see FastForwardCard below */}
      <Card title="About">
        <p className="text-sm text-ink-300 leading-relaxed">
          <strong>Maverick Ambitions</strong> is a generational business
          simulation set in <strong>Maverick County, NY</strong> — a fictional
          booming county on the outskirts of New York City. You start as a
          24-year-old with $15,000 and build an empire that outlasts you.
          This is v0.8.1 — the visibility patch on top of v0.8.0's scale
          update. 22 business types across six categories (Food & Hospitality,
          Retail, Entertainment, Services, Project-based, Heavy Industry)
          still run the shared retail and project engines. What's new:
          a personal wealth breakdown on the dashboard, weekly visitor /
          conversion numbers for retail storefronts, explainers under every
          tier button, a preview of how each hire moves service quality,
          and a warning banner when a store is understaffed. v0.9 brings
          channelized marketing, promotions, signage, loyalty, and hours
          of operation — see DESIGN.md.
        </p>
      </Card>
    </div>
  );
}

const PAUSE_MODES: ReadonlyArray<{
  value: GameSettings["pauseOnEvent"];
  label: string;
  blurb: string;
}> = [
  {
    value: "all",
    label: "Any event",
    blurb:
      "Pause on every game event. Safest — you'll never miss routine activity during a burst.",
  },
  {
    value: "blocking",
    label: "Blocking events only",
    blurb:
      "Default. Pause on distress, insolvency, macro shocks, rival moves, and lifecycle events. Ignore routine chatter.",
  },
  {
    value: "never",
    label: "Never",
    blurb:
      "Bursts ignore events entirely. Day / Week buttons run to their clock target; Event button falls back to blocking.",
  },
];

function FastForwardCard() {
  const mode = useGameStore(
    (s) => s.game?.settings?.pauseOnEvent ?? "blocking",
  );
  const setPauseOnEvent = useGameStore((s) => s.setPauseOnEvent);

  return (
    <Card
      title="Fast-forward"
      subtitle="Controls when Day ▸ / Week ▸ / Event ▸ pause."
    >
      <div className="space-y-2">
        {PAUSE_MODES.map((m) => {
          const active = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => setPauseOnEvent(m.value)}
              aria-pressed={active}
              className={cn(
                "w-full text-left rounded-lg border px-3 py-2 transition-colors",
                active
                  ? "border-accent bg-accent/10 text-ink-50"
                  : "border-ink-800 hover:border-ink-700 hover:bg-ink-900/50 text-ink-200",
              )}
            >
              <div className="text-sm font-semibold flex items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    active ? "bg-accent" : "bg-ink-700",
                  )}
                />
                {m.label}
                {active && (
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-accent font-semibold">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-400 mt-1 leading-snug">{m.blurb}</p>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
