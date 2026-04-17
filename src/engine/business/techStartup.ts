/**
 * Tech Startup — long runway, engineer-heavy, burns until it breaks out.
 *
 * Distinctive mechanics vs construction:
 *   - Short-to-medium project cycles (4–12 weeks = client contracts,
 *     pilots, integrations) plus optional VC raise events on the
 *     weekly pulse that deposit vc_proceeds.
 *   - Cost ledger uses rd_spend (R&D) rather than raw project_cost to
 *     surface that the burn is investment, not delivery cost.
 *   - Completed contracts generate small-ish residuals as SaaS-style
 *     recurring revenue (12 weeks).
 *
 * $180K startup, unlocks at $120K NW — earliest of the project-based
 * tier because it's the leanest (small crew, no yard rent, no equipment).
 */

import type { Business, LedgerEntry } from "@/types/game";

import { dollars } from "@/lib/money";

import { ledger } from "../economy/finance";

import {
  buildStaff,
  makeProjectModule,
  type ProjectModuleConfig,
  type ProjectBusinessState,
} from "./projectBase";
import type {
  BusinessStartupSpec,
  BusinessTickContext,
  BusinessTickResult,
  BusinessTypeModule,
  BusinessUiDescriptor,
} from "./types";

const ui: BusinessUiDescriptor = {
  label: "Tech Startup",
  icon: "💻",
  kpiLabels: ["Weekly Profit", "Active Contracts", "Prestige", "MRR Residual"],
  sections: ["projects", "staff", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(180_000),
  minimumCreditScore: 640,
  unlocksAt: { netWorthCents: dollars(120_000) },
};

const config: ProjectModuleConfig = {
  id: "tech_startup",
  ui,
  startup,
  billingLedger: "project_billing",
  costLedger: "rd_spend",
  residualLedger: "project_billing",

  startingCash: dollars(45_000),
  rentMultiplier: 1.2, // WeWork-style coworking
  marketingWeekly: dollars(1_200),

  initialStaff: (bizId) =>
    buildStaff(bizId, [
      { suffix: "ceo",  name: "CEO / Founder",        role: "founder",   wageMul: 2.6, skill: 70, morale: 75 },
      { suffix: "cto",  name: "CTO",                  role: "engineer",  wageMul: 2.4, skill: 72, morale: 72 },
      { suffix: "pm",   name: "Product Manager",      role: "manager",   wageMul: 1.8, skill: 60, morale: 70 },
      { suffix: "eng1", name: "Senior Engineer",      role: "engineer",  wageMul: 2.1, skill: 68, morale: 70 },
      { suffix: "eng2", name: "Mid-Level Engineer",   role: "engineer",  wageMul: 1.6, skill: 55, morale: 70 },
      { suffix: "des",  name: "Product Designer",     role: "designer",  wageMul: 1.7, skill: 60, morale: 72 },
    ]),

  projectDurationWeeksRange: [4, 12],
  projectBudgetRange: [dollars(80_000), dollars(450_000)],
  projectBurnRatio: 0.35,

  maxConcurrentProjects: 4,
  baseWeeklyPipelineChance: 0.42,

  residual: {
    weeklyFraction: 0.015, // ~1.5% / week × 12 = ~18% on top of billing
    durationWeeks: 12,
  },

  titleRoots: [
    "Enterprise SaaS Pilot",
    "Data Pipeline",
    "Custom AI Integration",
    "Onboarding Platform",
    "Internal Tools Rewrite",
    "Analytics Dashboard",
    "API Gateway",
    "Mobile App MVP",
  ] as const,
  kinds: ["pilot", "contract", "platform", "mvp"] as const,
};

const base = makeProjectModule(config);

// ---------- VC raise overlay ----------
/**
 * Wrap the module so that every ~12 weeks there's a chance of a VC raise.
 * The raise lands as `vc_proceeds` into cash on the weekly tick.
 */
const RAISE_CHECK_EVERY_WEEKS = 12;

export const techStartupModule: BusinessTypeModule = {
  ...base,
  onWeek(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
    const weekIndex = Math.floor(ctx.tick / (24 * 7));
    const result = base.onWeek(biz, ctx);

    // Only check at multiples of RAISE_CHECK_EVERY_WEEKS.
    if (weekIndex % RAISE_CHECK_EVERY_WEEKS !== 0) {
      return result;
    }

    const state = structuredClone(
      result.business.state,
    ) as unknown as ProjectBusinessState;
    // Chance scales with prestige. A prestige=1 startup sees ~70% odds; a
    // brand-new team sees ~15%.
    const chance = Math.min(0.75, 0.12 + state.prestige * 0.65);
    if (!ctx.rng.chance(chance)) return result;

    // Raise size: $500K..$4M
    const raise = Math.round(
      dollars(500_000) + ctx.rng.nextFloat(0, 1) * dollars(3_500_000),
    );
    const ledgerEntry: LedgerEntry = ledger(
      `vc-${result.business.id}-${ctx.tick}`,
      ctx.tick,
      raise,
      "vc_proceeds",
      `VC raise (${Math.round(state.prestige * 100)}% prestige)`,
      result.business.id,
    );

    return {
      ...result,
      business: {
        ...result.business,
        cash: result.business.cash + raise,
      },
      ledger: [...result.ledger, ledgerEntry],
      events: [
        ...result.events,
        {
          kind: "milestone",
          title: `${biz.name} closed a round`,
          detail: `Raised $${Math.round(raise / 100).toLocaleString()} in fresh funding. Runway extended.`,
        },
      ],
    };
  },
};
