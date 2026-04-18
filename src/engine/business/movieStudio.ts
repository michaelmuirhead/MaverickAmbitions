/**
 * Movie Studio — massive productions, box office on release, streaming tail.
 *
 * Distinctive mechanics vs gaming_studio:
 *   - Budgets are the largest in the project-based tier.
 *   - Delivery payout is booked as `box_office` (theatrical), not the
 *     generic project_billing, so the ledger can separate studio
 *     revenue clearly from contract work.
 *   - Long streaming tail (104 weeks ≈ 2 years of licensing).
 *   - Few concurrent productions (crews are pulled onto ONE film).
 *
 * $350K startup, unlocks at $280K NW.
 */

import { dollars } from "@/lib/money";

import {
  buildStaff,
  makeProjectModule,
  type ProjectModuleConfig,
} from "./projectBase";
import type { BusinessStartupSpec, BusinessUiDescriptor } from "./types";

const ui: BusinessUiDescriptor = {
  label: "Movie Studio",
  icon: "🎥",
  kpiLabels: ["Weekly Profit", "In Production", "Prestige", "Streaming Tail"],
  sections: ["productions", "crew", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(350_000),
  minimumCreditScore: 720,
  unlocksAt: { netWorthCents: dollars(280_000) },
};

const config: ProjectModuleConfig = {
  id: "movie_studio",
  ui,
  startup,
  billingLedger: "box_office",
  costLedger: "project_cost",
  residualLedger: "royalties",

  startingCash: dollars(75_000),
  rentMultiplier: 3.0, // soundstage + lot

  initialStaff: (bizId) =>
    buildStaff(bizId, [
      { suffix: "exec",  name: "Studio Head",          role: "executive",   wageMul: 3.2, skill: 72, morale: 72 },
      { suffix: "prod",  name: "Line Producer",        role: "producer",    wageMul: 2.4, skill: 68, morale: 70 },
      { suffix: "dir",   name: "Director",             role: "director",    wageMul: 2.8, skill: 70, morale: 72 },
      { suffix: "dp",    name: "Cinematographer",      role: "dp",          wageMul: 2.2, skill: 68, morale: 70 },
      { suffix: "ed",    name: "Editor",               role: "editor",      wageMul: 1.8, skill: 60, morale: 70 },
      { suffix: "vfx",   name: "VFX Supervisor",       role: "vfx",         wageMul: 2.2, skill: 68, morale: 70 },
      { suffix: "snd",   name: "Sound Mixer",          role: "audio",       wageMul: 1.5, skill: 55, morale: 68 },
      { suffix: "crew1", name: "Grip / Electric Lead", role: "grip",        wageMul: 1.3, skill: 50, morale: 66 },
      { suffix: "crew2", name: "Production Assistant", role: "pa",          wageMul: 0.95, skill: 35, morale: 64 },
    ]),

  projectDurationWeeksRange: [16, 40],
  projectBudgetRange: [dollars(2_000_000), dollars(18_000_000)],
  projectBurnRatio: 0.6,

  maxConcurrentProjects: 2,
  baseWeeklyPipelineChance: 0.18,

  residual: {
    weeklyFraction: 0.004, // 0.4% weekly × 104 wks = ~42% streaming/licensing tail
    durationWeeks: 104,
  },

  titleRoots: [
    "The Pale Crown",
    "Last Light",
    "Westbound",
    "Seventh Saint",
    "The Long Night",
    "Brass City",
    "Waterborne",
    "Empire of Ash",
  ] as const,
  kinds: ["feature", "series", "documentary", "animation"] as const,
};

export const movieStudioModule = makeProjectModule(config);
