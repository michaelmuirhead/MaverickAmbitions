/**
 * Shared engine for "project-based" businesses: construction, tech_startup,
 * gaming_studio, movie_studio, military_tech.
 *
 * What these businesses have in common vs retail/hospitality:
 *   - Revenue arrives in chunks on project completion, not hour-by-hour.
 *   - Cost accrues continuously (wages + per-hour burn) until delivery.
 *   - A queue of 0..N active projects progresses in parallel based on
 *     staff count and skill.
 *   - A stochastic pipeline surfaces new projects weekly.
 *   - Quality at completion depends on staff skill and time pressure.
 *
 * The differences (contract type, billing category, residuals, pipeline
 * richness) are pushed into a `ProjectModuleConfig`. Individual modules
 * (construction.ts, techStartup.ts, gamingStudio.ts, movieStudio.ts)
 * use `makeProjectModule(config)` and, where needed, wrap it to add
 * their distinctive bolt-ons (e.g. movie_studio box office, tech_startup
 * VC raises, gaming_studio royalties).
 */

import type {
  Business,
  BusinessDerived,
  BusinessKPIs,
  Cents,
  Id,
  LedgerCategory,
  LedgerEntry,
  Tick,
} from "@/types/game";

import { dollars } from "@/lib/money";
import { createRng } from "@/lib/rng";
import type { RNG } from "@/lib/rng";

import { ECONOMY } from "../economy/constants";
import { corporateTax, ledger } from "../economy/finance";

import type {
  BusinessStartupSpec,
  BusinessTickContext,
  BusinessTickResult,
  BusinessTypeModule,
  BusinessUiDescriptor,
} from "./types";

// ---------- Types ----------

export type ProjectStatus = "active" | "completed" | "failed";

export interface Project {
  id: Id;
  title: string;
  /** Total payout on successful completion, in cents. */
  budgetCents: Cents;
  /** Absolute tick the project started at. */
  startedAtTick: Tick;
  /** How many hours of work until eligible for completion. */
  durationHours: number;
  /** 0..1 progress toward delivery. */
  progress: number;
  /** Hourly burn while the project is active (separate from wages). */
  hourlyBurnCents: Cents;
  /** 0..1 current quality score (only meaningful once completed). */
  quality: number;
  status: ProjectStatus;
  /** Optional: residual royalties/licensing after completion. */
  residualWeeklyCents?: Cents;
  /** How many weeks of residuals remain. */
  residualWeeksRemaining?: number;
  /** Flavor tag surfaced to UI (e.g. "AAA RPG", "Downtown Tower"). */
  kind?: string;
}

export interface ProjectStaff {
  id: Id;
  name: string;
  role: string;
  hourlyWageCents: Cents;
  skill: number;
  morale: number;
}

export interface ProjectBusinessState {
  projects: Project[];
  completedProjectCount: number;
  failedProjectCount: number;

  staff: ProjectStaff[];

  /** Brand prestige / reputation inside the business's industry. 0..1. */
  prestige: number;
  /** 0..1 marketing / BD score (drives pipeline density). */
  marketingScore: number;
  marketingWeekly: Cents;
  rentMonthly: Cents;

  // accumulators
  weeklyBillingsAcc: Cents;
  weeklyResidualsAcc: Cents;
  weeklyCogsAcc: Cents;
  weeklyBurnAcc: Cents;
  wagesAccrued: Cents;
}

export interface ProjectModuleConfig {
  id: import("@/types/game").BusinessTypeId;
  ui: BusinessUiDescriptor;
  startup: BusinessStartupSpec;

  /** Ledger category for project payouts (e.g. "project_billing"). */
  billingLedger: LedgerCategory;
  /** Ledger category for in-progress cost burn (e.g. "project_cost"). */
  costLedger: LedgerCategory;
  /** Optional ledger category for residuals (royalties / box_office / etc.). */
  residualLedger?: LedgerCategory;

  /** Starting cash for a fresh instance. */
  startingCash: Cents;
  /** Monthly rent factor — multiplied by ECONOMY.BASE_RENT_MONTHLY_CENTS. */
  rentMultiplier: number;
  /** Default weekly marketing / BD spend. */
  marketingWeekly: Cents;
  /** Initial staff roster. */
  initialStaff(bizId: Id): ProjectStaff[];

  /** Min/max project duration in weeks (1 week = 168h). */
  projectDurationWeeksRange: [number, number];
  /** Min/max project budget in cents. */
  projectBudgetRange: [Cents, Cents];
  /** How much of the budget burns as COGS before delivery. 0..0.8. */
  projectBurnRatio: number;

  /** Max concurrent projects. More staff = more parallelism. */
  maxConcurrentProjects: number;
  /** Weekly chance a new project lands. Modulated by prestige + marketing. */
  baseWeeklyPipelineChance: number;

  /** Residual configuration — if set, completed projects produce this. */
  residual?: {
    /** Fraction of budget paid out weekly as residuals. */
    weeklyFraction: number;
    /** Number of weeks residuals last. */
    durationWeeks: number;
  };

  /** Flavor-specific project title generator. */
  titleRoots: readonly string[];
  /** Optional: flavor tags (e.g. genre buckets). */
  kinds?: readonly string[];
}

// ---------- Factory ----------

export function makeProjectModule(
  config: ProjectModuleConfig,
): BusinessTypeModule {
  function createBusiness(params: {
    id: Id;
    ownerId: Id;
    name: string;
    locationId: Id;
    tick: Tick;
    seed: string;
  }): Business {
    const state: ProjectBusinessState = {
      projects: [],
      completedProjectCount: 0,
      failedProjectCount: 0,
      staff: config.initialStaff(params.id),
      prestige: 0.25,
      marketingScore: 0.3,
      marketingWeekly: config.marketingWeekly,
      rentMonthly: Math.round(
        ECONOMY.BASE_RENT_MONTHLY_CENTS * config.rentMultiplier,
      ),

      weeklyBillingsAcc: 0,
      weeklyResidualsAcc: 0,
      weeklyCogsAcc: 0,
      weeklyBurnAcc: 0,
      wagesAccrued: 0,
    };

    const kpis: BusinessKPIs = {
      weeklyRevenue: 0,
      weeklyExpenses: 0,
      weeklyProfit: 0,
      marketShare: 0.1,
      customerSatisfaction: 65,
    };

    const derived: BusinessDerived = {
      footTraffic: 0,
      stockLevel: 1,
      pendingWages: 0,
      riskScore: 25,
    };

    return {
      id: params.id,
      ownerId: params.ownerId,
      type: config.id,
      name: params.name,
      locationId: params.locationId,
      openedAtTick: params.tick,
      cash: config.startingCash,
      state: state as unknown as Record<string, unknown>,
      kpis,
      derived,
    };
  }

  function getState(biz: Business): ProjectBusinessState {
    return structuredClone(biz.state) as unknown as ProjectBusinessState;
  }

  function avgSkill(state: ProjectBusinessState): number {
    if (state.staff.length === 0) return 0;
    return (
      state.staff.reduce((a, s) => a + (s.skill * s.morale) / 10000, 0) /
      state.staff.length
    );
  }

  function generateProject(
    tick: Tick,
    rng: RNG,
    prestigeHalo: number,
  ): Project {
    const [minWk, maxWk] = config.projectDurationWeeksRange;
    const weeks = rng.nextInt(minWk, maxWk);
    const durationHours = weeks * 24 * 7;
    const [minBudget, maxBudget] = config.projectBudgetRange;
    const budget = Math.round(
      (minBudget + (maxBudget - minBudget) * rng.next()) *
        (0.85 + prestigeHalo * 0.6),
    );
    const burnHourly = Math.round(
      (budget * config.projectBurnRatio) / durationHours,
    );
    const titleBase = config.titleRoots[
      rng.nextInt(0, config.titleRoots.length - 1)
    ] ?? "Project";
    const suffix = rng.nextInt(100, 999);
    const kind =
      config.kinds && config.kinds.length > 0
        ? config.kinds[rng.nextInt(0, config.kinds.length - 1)]
        : undefined;
    return {
      id: `proj-${tick}-${suffix}`,
      title: `${titleBase} #${suffix}`,
      budgetCents: budget,
      startedAtTick: tick,
      durationHours,
      progress: 0,
      hourlyBurnCents: burnHourly,
      quality: 0,
      status: "active",
      kind,
    };
  }

  function onHour(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
    const state = getState(biz);
    const ledgerEntries: LedgerEntry[] = [];
    const events: BusinessTickResult["events"] = [];

    if (state.staff.length === 0 || state.projects.length === 0) {
      // Still accrue wages if staff present.
      if (state.staff.length > 0) {
        const wages = state.staff.reduce((a, s) => a + s.hourlyWageCents, 0);
        state.wagesAccrued += wages;
      }
      return {
        business: updateDerivedOnly(biz, state),
        ledger: [],
        events: [],
      };
    }

    const skill = avgSkill(state);
    // Effective working hours per project per real hour.
    // Staff spread across concurrent projects.
    const workPerProject =
      (0.6 + skill * 0.8) *
      (1 / Math.max(1, state.projects.length));

    let hourCogs = 0;
    let hourBurn = 0;

    for (const p of state.projects) {
      if (p.status !== "active") continue;
      const progressDelta = workPerProject / p.durationHours;
      p.progress = Math.min(1, p.progress + progressDelta);
      // Quality ratchets up with skill, slightly noise-ed.
      p.quality = Math.min(
        1,
        p.quality + (skill * 1.2 - p.quality) * progressDelta,
      );

      // Burn — COGS tier.
      hourCogs += p.hourlyBurnCents;
      hourBurn += p.hourlyBurnCents;
    }

    if (hourCogs > 0) {
      ledgerEntries.push(
        ledger(
          `burn-${biz.id}-${ctx.tick}`,
          ctx.tick,
          -hourCogs,
          config.costLedger,
          "Project burn",
          biz.id,
        ),
      );
    }

    // Wages accrue hourly.
    const wagesThisHour = state.staff.reduce((a, s) => a + s.hourlyWageCents, 0);
    state.wagesAccrued += wagesThisHour;

    state.weeklyCogsAcc += hourCogs;
    state.weeklyBurnAcc += hourBurn;

    const newCash = biz.cash - hourCogs;

    const updated: Business = {
      ...biz,
      cash: newCash,
      state: state as unknown as Record<string, unknown>,
      derived: {
        ...biz.derived,
        footTraffic: state.projects.filter((p) => p.status === "active").length,
        stockLevel: 1,
        pendingWages: state.wagesAccrued,
        riskScore: Math.max(
          0,
          Math.min(
            100,
            25 + state.failedProjectCount * 5 + (1 - skill) * 30,
          ),
        ),
      },
    };
    return { business: updated, ledger: ledgerEntries, events };
  }

  function onDay(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
    const state = getState(biz);
    const events: BusinessTickResult["events"] = [];
    const ledgerEntries: LedgerEntry[] = [];
    let cash = biz.cash;

    // Staff drift.
    for (const s of state.staff) {
      s.morale = Math.max(0, Math.min(100, s.morale + ctx.rng.nextFloat(-2, 2)));
      s.skill = Math.min(100, s.skill + ctx.rng.nextFloat(0, 0.2));
    }

    // Complete any projects that have hit 100% progress.
    const completing = state.projects.filter(
      (p) => p.status === "active" && p.progress >= 1,
    );
    for (const p of completing) {
      // Outcome: successful iff quality > 0.35.
      const success = p.quality >= 0.35;
      if (success) {
        const payout = Math.round(p.budgetCents * (0.7 + p.quality * 0.5));
        cash += payout;
        p.status = "completed";
        state.completedProjectCount += 1;
        ledgerEntries.push(
          ledger(
            `bill-${biz.id}-${ctx.tick}-${p.id}`,
            ctx.tick,
            payout,
            config.billingLedger,
            `Delivered: ${p.title}`,
            biz.id,
          ),
        );
        state.weeklyBillingsAcc += payout;
        state.prestige = Math.min(1, state.prestige + 0.01 + p.quality * 0.02);
        events.push({
          kind: "business_event",
          title: `${biz.name} delivered “${p.title}”`,
          detail: `Quality ${Math.round(p.quality * 100)}/100 — payout booked.`,
        });
        // Set up residuals if configured.
        if (config.residual) {
          p.residualWeeklyCents = Math.round(
            p.budgetCents * config.residual.weeklyFraction,
          );
          p.residualWeeksRemaining = config.residual.durationWeeks;
        }
      } else {
        p.status = "failed";
        state.failedProjectCount += 1;
        state.prestige = Math.max(0, state.prestige - 0.05);
        events.push({
          kind: "business_event",
          title: `${biz.name} botched “${p.title}”`,
          detail: "Client rejected delivery. No payout. Prestige took a hit.",
          impact: { reputationDelta: -1 },
        });
      }
    }

    return {
      business: {
        ...biz,
        cash,
        state: state as unknown as Record<string, unknown>,
      },
      ledger: ledgerEntries,
      events,
    };
  }

  function onWeek(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
    const state = getState(biz);
    const ledgerEntries: LedgerEntry[] = [];
    const events: BusinessTickResult["events"] = [];
    let cash = biz.cash;

    // Wages.
    if (state.wagesAccrued > 0) {
      cash -= state.wagesAccrued;
      ledgerEntries.push(
        ledger(
          `wages-${biz.id}-${ctx.tick}`,
          ctx.tick,
          -state.wagesAccrued,
          "wages",
          "Weekly wages",
          biz.id,
        ),
      );
    }

    // Rent.
    const weeklyRent = Math.round(state.rentMonthly / 4);
    cash -= weeklyRent;
    ledgerEntries.push(
      ledger(
        `rent-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -weeklyRent,
        "rent",
        "Weekly rent",
        biz.id,
      ),
    );

    // Marketing / BD.
    if (state.marketingWeekly > 0) {
      cash -= state.marketingWeekly;
      ledgerEntries.push(
        ledger(
          `mkt-${biz.id}-${ctx.tick}`,
          ctx.tick,
          -state.marketingWeekly,
          "marketing",
          "BD / marketing",
          biz.id,
        ),
      );
      state.marketingScore = Math.min(
        1,
        state.marketingScore * 0.6 +
          Math.min(1, state.marketingWeekly / dollars(1_800)) * 0.4,
      );
    } else {
      state.marketingScore *= 0.6;
    }

    // Residuals — iterate completed projects with remaining residual weeks.
    let residualsThisWeek = 0;
    for (const p of state.projects) {
      if (
        p.status === "completed" &&
        p.residualWeeklyCents &&
        p.residualWeeksRemaining &&
        p.residualWeeksRemaining > 0
      ) {
        cash += p.residualWeeklyCents;
        residualsThisWeek += p.residualWeeklyCents;
        p.residualWeeksRemaining -= 1;
        if (config.residualLedger) {
          ledgerEntries.push(
            ledger(
              `resid-${biz.id}-${ctx.tick}-${p.id}`,
              ctx.tick,
              p.residualWeeklyCents,
              config.residualLedger,
              `Residual: ${p.title}`,
              biz.id,
            ),
          );
        }
      }
    }
    state.weeklyResidualsAcc += residualsThisWeek;

    // Pipeline roll — new project arrival.
    const pipelineChance = Math.min(
      0.95,
      config.baseWeeklyPipelineChance *
        (0.6 + state.prestige * 1.2) *
        (0.6 + state.marketingScore * 0.9),
    );
    const activeCount = state.projects.filter((p) => p.status === "active").length;
    if (
      activeCount < config.maxConcurrentProjects &&
      ctx.rng.chance(pipelineChance)
    ) {
      const fresh = generateProject(
        ctx.tick,
        ctx.rng.child("pipeline"),
        state.prestige,
      );
      state.projects.push(fresh);
      events.push({
        kind: "business_event",
        title: `${biz.name} booked “${fresh.title}”`,
        detail: `New ${Math.round(fresh.durationHours / 24 / 7)}-week project, budget ~$${Math.round(
          fresh.budgetCents / 100,
        ).toLocaleString()}.`,
      });
    }

    // Prune fully-retired completed projects (no residuals left).
    state.projects = state.projects.filter(
      (p) =>
        p.status === "active" ||
        (p.status === "completed" &&
          (p.residualWeeksRemaining ?? 0) > 0),
    );

    const weeklyRevenue = state.weeklyBillingsAcc + residualsThisWeek;
    const weeklyExpenses =
      state.weeklyCogsAcc +
      state.wagesAccrued +
      weeklyRent +
      state.marketingWeekly;
    const pretax = weeklyRevenue - weeklyExpenses;
    const tax = corporateTax(pretax);
    if (tax > 0) {
      cash -= tax;
      ledgerEntries.push(
        ledger(
          `tax-${biz.id}-${ctx.tick}`,
          ctx.tick,
          -tax,
          "tax",
          "Weekly corporate tax",
          biz.id,
        ),
      );
    }
    const weeklyProfit = pretax - tax;

    // CSAT nudge.
    const target =
      50 +
      state.prestige * 30 +
      state.marketingScore * 10 -
      state.failedProjectCount * 2;
    const next =
      biz.kpis.customerSatisfaction +
      (Math.max(0, Math.min(90, target)) - biz.kpis.customerSatisfaction) * 0.15;

    // Reset weekly accumulators.
    state.weeklyBillingsAcc = 0;
    state.weeklyResidualsAcc = 0;
    state.weeklyCogsAcc = 0;
    state.weeklyBurnAcc = 0;
    state.wagesAccrued = 0;

    const kpis: BusinessKPIs = {
      ...biz.kpis,
      weeklyRevenue,
      weeklyExpenses,
      weeklyProfit,
      customerSatisfaction: next,
    };

    return {
      business: {
        ...biz,
        cash,
        state: state as unknown as Record<string, unknown>,
        kpis,
        derived: { ...biz.derived, pendingWages: 0 },
      },
      ledger: ledgerEntries,
      events,
    };
  }

  function updateDerivedOnly(
    biz: Business,
    state: ProjectBusinessState,
  ): Business {
    return {
      ...biz,
      state: state as unknown as Record<string, unknown>,
      derived: { ...biz.derived, pendingWages: state.wagesAccrued },
    };
  }

  return {
    id: config.id,
    ui: config.ui,
    startup: config.startup,
    create: createBusiness,
    onHour,
    onDay,
    onWeek,
  };
}

// Utility for seed-safe initial staff factory from consumers.
export function buildStaff(
  bizId: Id,
  roster: ReadonlyArray<{
    suffix: string;
    name: string;
    role: string;
    wageMul: number;
    skill: number;
    morale: number;
  }>,
): ProjectStaff[] {
  return roster.map((r) => ({
    id: `${bizId}-${r.suffix}`,
    name: r.name,
    role: r.role,
    hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * r.wageMul),
    skill: r.skill,
    morale: r.morale,
  }));
}

// Re-export createRng type relay so consumers don't need to import both libs.
export { createRng };
