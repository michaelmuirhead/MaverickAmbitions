/**
 * Military Tech — government contracts, high-dollar, slow-moving.
 *
 * Mechanically close to the tech startup / gaming studio, but wrapped
 * with a few distinctive twists:
 *   - Contract payouts land in `gov_contract` ledger (so grand strategy
 *     / tax dashboards can separate private vs. public revenue).
 *   - Ongoing R&D is continuous and costly — costLedger="rd_spend".
 *   - No residuals: gov checks are one-shot on delivery.
 *   - Fewer concurrent programs (max 2) — a defense contractor can't
 *     split engineering across many deliveries.
 *
 * $500K startup, unlocks at $400K NW — highest-tier of the
 * project-based ladder.
 */

import { dollars } from "@/lib/money";

import {
  buildStaff,
  makeProjectModule,
  type ProjectModuleConfig,
} from "./projectBase";
import type { BusinessStartupSpec, BusinessUiDescriptor } from "./types";

const ui: BusinessUiDescriptor = {
  label: "Military Tech",
  icon: "🛰️",
  kpiLabels: ["Weekly Profit", "Active Contracts", "Prestige", "R&D Burn"],
  sections: ["contracts", "staff", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(500_000),
  minimumCreditScore: 740,
  unlocksAt: { netWorthCents: dollars(400_000) },
};

const config: ProjectModuleConfig = {
  id: "military_tech",
  ui,
  startup,
  billingLedger: "gov_contract",
  costLedger: "rd_spend",

  startingCash: dollars(90_000),
  rentMultiplier: 4.0, // secure facility

  initialStaff: (bizId) =>
    buildStaff(bizId, [
      { suffix: "exec",  name: "Program Director",     role: "executive",   wageMul: 3.0, skill: 72, morale: 72 },
      { suffix: "eng1",  name: "Principal Engineer",   role: "engineer",    wageMul: 2.8, skill: 75, morale: 70 },
      { suffix: "eng2",  name: "Controls Engineer",    role: "engineer",    wageMul: 2.2, skill: 68, morale: 68 },
      { suffix: "eng3",  name: "Hardware Engineer",    role: "engineer",    wageMul: 2.2, skill: 68, morale: 68 },
      { suffix: "sys",   name: "Systems Integrator",   role: "integrator",  wageMul: 2.0, skill: 65, morale: 70 },
      { suffix: "sec",   name: "Security Officer",     role: "security",    wageMul: 1.6, skill: 55, morale: 68 },
      { suffix: "qa",    name: "Compliance Lead",      role: "compliance",  wageMul: 1.8, skill: 60, morale: 68 },
      { suffix: "adm",   name: "Contracts Admin",      role: "admin",       wageMul: 1.5, skill: 55, morale: 68 },
    ]),

  projectDurationWeeksRange: [26, 52],
  projectBudgetRange: [dollars(3_000_000), dollars(28_000_000)],
  projectBurnRatio: 0.5,

  maxConcurrentProjects: 2,
  baseWeeklyPipelineChance: 0.12,

  titleRoots: [
    "RFP-Stratos",
    "Program Ironline",
    "Contract Echo-7",
    "DoD Skylattice",
    "JTRS Uplink",
    "Aegis Forward",
    "Blackwater Sensor",
    "DARPA Nightshift",
  ] as const,
  kinds: ["sensors", "communications", "avionics", "cyber"] as const,
};

export const militaryTechModule = makeProjectModule(config);
