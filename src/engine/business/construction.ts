/**
 * Construction — bid, build, deliver. Heavy crew, weather-exposed projects.
 *
 * Distinctive mechanics:
 *   - Longer projects (6–24 weeks). Budgets scale with prestige.
 *   - No residuals — every project is one-and-done billing.
 *   - High weekly burn while building; payout on delivery.
 *
 * $300K startup, unlocks at $240K NW.
 */

import { dollars } from "@/lib/money";

import { ECONOMY } from "../economy/constants";

import {
  buildStaff,
  makeProjectModule,
  type ProjectModuleConfig,
} from "./projectBase";
import type { BusinessStartupSpec, BusinessUiDescriptor } from "./types";

const ui: BusinessUiDescriptor = {
  label: "Construction Firm",
  icon: "🏗️",
  kpiLabels: ["Weekly Profit", "Active Projects", "Prestige", "Failed Builds"],
  sections: ["projects", "crew", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(300_000),
  minimumCreditScore: 700,
  unlocksAt: { netWorthCents: dollars(240_000) },
};

const config: ProjectModuleConfig = {
  id: "construction",
  ui,
  startup,
  billingLedger: "project_billing",
  costLedger: "project_cost",

  startingCash: dollars(30_000),
  rentMultiplier: 2.5, // yard + trailer + equipment parking

  initialStaff: (bizId) =>
    buildStaff(bizId, [
      { suffix: "pm",      name: "Project Manager",       role: "manager",       wageMul: 2.0, skill: 65, morale: 72 },
      { suffix: "super",   name: "Site Superintendent",   role: "supervisor",    wageMul: 1.8, skill: 65, morale: 70 },
      { suffix: "eng",     name: "Structural Engineer",   role: "engineer",      wageMul: 2.2, skill: 70, morale: 72 },
      { suffix: "fore",    name: "Foreman",               role: "foreman",       wageMul: 1.6, skill: 60, morale: 68 },
      { suffix: "op1",     name: "Heavy Equipment Op.",   role: "operator",      wageMul: 1.4, skill: 55, morale: 66 },
      { suffix: "op2",     name: "Carpenter Lead",        role: "carpenter",     wageMul: 1.2, skill: 55, morale: 68 },
      { suffix: "lab1",    name: "Laborer Alpha",         role: "laborer",       wageMul: 0.95, skill: 40, morale: 62 },
      { suffix: "lab2",    name: "Laborer Beta",          role: "laborer",       wageMul: 0.95, skill: 40, morale: 62 },
    ]),

  projectDurationWeeksRange: [6, 24],
  projectBudgetRange: [dollars(250_000), dollars(3_500_000)],
  projectBurnRatio: 0.55,

  maxConcurrentProjects: 3,
  baseWeeklyPipelineChance: 0.28,

  titleRoots: [
    "Downtown Tower",
    "Riverside Condos",
    "Industrial Park",
    "Medical Campus",
    "School Renovation",
    "Warehouse Build-Out",
    "Mixed-Use Block",
    "Parking Structure",
  ] as const,
  kinds: ["commercial", "residential", "industrial", "institutional"] as const,
};

export const constructionModule = makeProjectModule(config);

// silence unused warning for ECONOMY (kept for potential weather multiplier hook)
void ECONOMY;
