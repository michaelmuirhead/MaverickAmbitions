/**
 * Random events table. Small for MVP — expand aggressively.
 */

import { nanoid } from "nanoid";

import type { GameEvent, Tick } from "@/types/game";

import { dollars } from "@/lib/money";
import type { RNG } from "@/lib/rng";

interface EventTemplate {
  kind: GameEvent["kind"];
  weight: number;
  build: (rng: RNG, tick: Tick) => Omit<GameEvent, "id" | "dismissed">;
}

export const EVENT_TABLE: EventTemplate[] = [
  {
    kind: "business_event",
    weight: 3,
    build: (rng, tick) => ({
      tick,
      kind: "business_event",
      title: "Shoplifter!",
      detail: "A quick-handed visitor slipped a few items. Small loss.",
      impact: { cashDelta: -dollars(rng.nextInt(15, 120)) },
    }),
  },
  {
    kind: "business_event",
    weight: 1,
    build: (rng, tick) => ({
      tick,
      kind: "business_event",
      title: "Health inspection",
      detail: "Inspector arrived unannounced. Everything looked fine.",
      impact: { cashDelta: -dollars(rng.nextInt(50, 200)) },
    }),
  },
  {
    kind: "personal_event",
    weight: 2,
    build: (_rng, tick) => ({
      tick,
      kind: "personal_event",
      title: "Good night's sleep",
      detail: "You wake up refreshed.",
    }),
  },
  {
    kind: "macro_shock",
    weight: 0.25,
    build: (_rng, tick) => ({
      tick,
      kind: "macro_shock",
      title: "Recession fears",
      detail: "Consumers tighten spending. Foot traffic dips this week.",
    }),
  },
];

export function rollRandomEvent(rng: RNG, tick: Tick): GameEvent | undefined {
  if (EVENT_TABLE.length === 0) return undefined;
  const totalWeight = EVENT_TABLE.reduce((a, b) => a + b.weight, 0);
  let r = rng.next() * totalWeight;
  for (const tmpl of EVENT_TABLE) {
    r -= tmpl.weight;
    if (r <= 0) {
      return { ...tmpl.build(rng, tick), id: nanoid(6), dismissed: false };
    }
  }
  return undefined;
}
