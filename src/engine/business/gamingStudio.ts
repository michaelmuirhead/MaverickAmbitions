/**
 * Gaming Studio — multi-quarter title dev cycles + royalty tail.
 *
 * Distinctive mechanics vs tech_startup:
 *   - Longer cycles (12–26 weeks = full title development) with much
 *     bigger budgets. Fewer concurrent titles.
 *   - Post-launch royalties run for 52 weeks (DLC + sales long tail) as
 *     `royalties` ledger entries.
 *   - Cost ledger uses project_cost (treating dev as COGS for tax).
 *
 * $220K startup, unlocks at $160K NW.
 */

import { dollars } from "@/lib/money";

import {
  buildStaff,
  makeProjectModule,
  type ProjectModuleConfig,
} from "./projectBase";
import type { BusinessStartupSpec, BusinessUiDescriptor } from "./types";

const ui: BusinessUiDescriptor = {
  label: "Gaming Studio",
  icon: "🎮",
  kpiLabels: ["Weekly Profit", "Titles in Dev", "Prestige", "Royalties"],
  sections: ["productions", "staff", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(220_000),
  minimumCreditScore: 660,
  unlocksAt: { netWorthCents: dollars(160_000) },
};

const config: ProjectModuleConfig = {
  id: "gaming_studio",
  ui,
  startup,
  billingLedger: "project_billing",
  costLedger: "project_cost",
  residualLedger: "royalties",

  startingCash: dollars(55_000),
  rentMultiplier: 1.6,
  marketingWeekly: dollars(1_800),

  initialStaff: (bizId) =>
    buildStaff(bizId, [
      { suffix: "cd",     name: "Creative Director",     role: "director",     wageMul: 2.4, skill: 70, morale: 72 },
      { suffix: "pm",     name: "Producer",              role: "producer",     wageMul: 2.0, skill: 65, morale: 72 },
      { suffix: "eng1",   name: "Lead Engineer",         role: "engineer",     wageMul: 2.2, skill: 70, morale: 70 },
      { suffix: "eng2",   name: "Gameplay Engineer",     role: "engineer",     wageMul: 1.7, skill: 60, morale: 70 },
      { suffix: "art1",   name: "Art Director",          role: "artist",       wageMul: 2.0, skill: 68, morale: 72 },
      { suffix: "art2",   name: "3D Artist",             role: "artist",       wageMul: 1.5, skill: 55, morale: 68 },
      { suffix: "snd",    name: "Sound Designer",        role: "audio",        wageMul: 1.4, skill: 55, morale: 70 },
      { suffix: "qa",     name: "QA Lead",               role: "qa",           wageMul: 1.2, skill: 55, morale: 66 },
    ]),

  projectDurationWeeksRange: [12, 26],
  projectBudgetRange: [dollars(500_000), dollars(6_000_000)],
  projectBurnRatio: 0.45,

  maxConcurrentProjects: 2,
  baseWeeklyPipelineChance: 0.22,

  residual: {
    weeklyFraction: 0.008, // ~0.8% / week × 52 = ~42% royalty tail
    durationWeeks: 52,
  },

  titleRoots: [
    "Sword & Sigil",
    "Starlanes",
    "Deadzone Drifter",
    "Kingdom Echoes",
    "Pixel Coliseum",
    "Neon Harvest",
    "The Last Farmhouse",
    "Archipelago Rising",
  ] as const,
  kinds: ["AAA", "indie", "mobile", "DLC"] as const,
};

export const gamingStudioModule = makeProjectModule(config);
