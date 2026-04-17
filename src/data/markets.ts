/**
 * Starter neighborhoods. MVP presents ~4 markets in one virtual city.
 */

import type { Market } from "@/types/game";

import { dollars } from "@/lib/money";

export const STARTER_MARKETS: Record<string, Market> = {
  m_downtown: {
    id: "m_downtown",
    name: "Downtown",
    population: 42_000,
    medianIncome: dollars(72_000),
    desirability: 0.85,
    businessIds: [],
  },
  m_riverside: {
    id: "m_riverside",
    name: "Riverside",
    population: 28_000,
    medianIncome: dollars(58_000),
    desirability: 0.6,
    businessIds: [],
  },
  m_oak_hills: {
    id: "m_oak_hills",
    name: "Oak Hills",
    population: 35_000,
    medianIncome: dollars(96_000),
    desirability: 0.92,
    businessIds: [],
  },
  m_southside: {
    id: "m_southside",
    name: "Southside",
    population: 52_000,
    medianIncome: dollars(42_000),
    desirability: 0.45,
    businessIds: [],
  },
};
