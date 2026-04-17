import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";

/**
 * v0.7 first-time tutorial.
 *
 * Six-step coach mark explaining the core loop. Shown once — a `"seen"`
 * flag lives in localStorage (game state stays pure).
 *
 * Rendered inside `GameLayout` so every in-game page can open it; the
 * player can manually replay it from Settings → "Replay tutorial".
 */

// v0.7.3 bumped the key so returning players see the new Maverick County
// welcome step once.
const STORAGE_KEY = "ma:tutorial:v0.7.3";

export interface TutorialStep {
  title: string;
  body: string;
  icon: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    icon: "🗽",
    title: "Welcome to Maverick County.",
    body: "You've landed in Maverick County, NY — a fictional booming county on the outskirts of New York City. 46 neighborhoods span a mini-Manhattan downtown, Westchester-style suburbs, upstate hamlets, a Long Island-adjacent coast, and a working harbor.",
  },
  {
    icon: "🏙️",
    title: "Pick a neighborhood.",
    body: "Each neighborhood has its own population, income, and desirability. Start with one that matches your capital — the Southside or the Rust Belt are cheap ways in; Oak Hills and Summit Ridge cost more but command premium pricing.",
  },
  {
    icon: "🏪",
    title: "Open your first business.",
    body: "$15K in personal cash (or a good credit score for an SBA loan) is enough for a corner store. Hit a cafe/bar/restaurant once your wallet catches up.",
  },
  {
    icon: "⏩",
    title: "Advance time.",
    body: "Use the speed controls in the top nav to fast-forward. Time is ticks — every tick is one in-game hour. Revenue, wages, and payments all settle on the tick.",
  },
  {
    icon: "📊",
    title: "Watch the money.",
    body: "Weekly profit is the headline number. Negative weeks are fine for a few cycles after opening — inventory and morale take time to stabilize.",
  },
  {
    icon: "🎛️",
    title: "Tune each business.",
    body: "Tap a business on the Your Businesses page to open its detail. Adjust SKU pricing, hire/fire staff, set a marketing budget. Every lever compounds.",
  },
  {
    icon: "🏛️",
    title: "Build the dynasty.",
    body: "Marry, raise heirs, and train them up in the Family tab. When your character dies, a well-prepared heir inherits the empire without missing a beat.",
  },
];

export function hasSeenTutorial(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markTutorialSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Ignore — storage quota / private mode.
  }
}

export function resetTutorialSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

export interface TutorialProps {
  /** When true, force-open the overlay regardless of the seen flag. */
  open?: boolean;
  /** Called when the player finishes or dismisses the tutorial. */
  onClose?: () => void;
}

export function Tutorial({ open, onClose }: TutorialProps) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  // First-time auto-open — only when the `open` prop wasn't supplied.
  useEffect(() => {
    if (open !== undefined) return;
    if (!hasSeenTutorial()) setVisible(true);
  }, [open]);

  // Controlled mode — follow the prop.
  useEffect(() => {
    if (open === undefined) return;
    setVisible(open);
    if (open) setStep(0);
  }, [open]);

  if (!visible) return null;

  const current = TUTORIAL_STEPS[step];
  const isLast = step === TUTORIAL_STEPS.length - 1;

  const close = () => {
    markTutorialSeen();
    setVisible(false);
    onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-ink-800 bg-ink-900 shadow-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-3xl leading-none">{current.icon}</div>
          <div className="text-[11px] text-ink-500 font-mono tabular-nums">
            {step + 1} / {TUTORIAL_STEPS.length}
          </div>
        </div>
        <h2
          id="tutorial-title"
          className="mt-3 text-lg font-semibold text-ink-50"
        >
          {current.title}
        </h2>
        <p className="mt-2 text-sm text-ink-300 leading-relaxed">
          {current.body}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={close}
          >
            Skip
          </Button>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              Back
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (isLast) close();
                else setStep((s) => s + 1);
              }}
            >
              {isLast ? "Start playing" : "Next"}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex justify-center gap-1.5">
          {TUTORIAL_STEPS.map((_, i) => (
            <span
              key={i}
              className={
                "h-1.5 w-1.5 rounded-full " +
                (i === step ? "bg-accent" : "bg-ink-700")
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
