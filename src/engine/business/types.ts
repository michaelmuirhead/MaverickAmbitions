/**
 * Business system interfaces.
 *
 * A `BusinessTypeModule` is a self-contained plugin: it knows how to
 * create, simulate, and report on one business type. The registry
 * maps a BusinessTypeId to its module, so adding a new industry
 * (cafe, real estate, sports team, nation) means writing a new module
 * and registering it. No core changes required.
 */

import type {
  Business,
  BusinessTypeId,
  Cents,
  GameState,
  Id,
  LedgerEntry,
  MacroState,
  Tick,
} from "@/types/game";

import type { RNG } from "@/lib/rng";

/** Context passed to business tick functions. */
export interface BusinessTickContext {
  tick: Tick;
  macro: MacroState;
  /** RNG scoped to this business + tick for fairness. */
  rng: RNG;
  /** Read-only view of whole game state (markets, rivals, etc.). */
  world: Readonly<GameState>;
}

/** Output of a business tick — pure-data deltas to apply. */
export interface BusinessTickResult {
  /** Updated business snapshot (replaces the old one). */
  business: Business;
  /** Ledger entries to append to the game ledger. */
  ledger: LedgerEntry[];
  /** Events surfaced (notifications, milestones, incidents). */
  events: Array<{
    kind: "business_event" | "milestone";
    title: string;
    detail: string;
    impact?: { cashDelta?: Cents; reputationDelta?: number };
  }>;
}

/** Metadata for the UI to render the business — KPIs, sections, actions. */
export interface BusinessUiDescriptor {
  label: string;
  icon: string; // emoji or icon id; UI picks
  kpiLabels: string[]; // which KPIs to prominently show
  sections: Array<
    | "inventory"
    | "staff"
    | "pricing"
    | "marketing"
    | "menu"
    | "roster"
    | "tenants"
    | "projects"
    | "wells"
    | "city_services"
  >;
}

/** Cost / capability profile of opening one. */
export interface BusinessStartupSpec {
  startupCostCents: Cents;
  minimumCreditScore?: number;
  requiredSkills?: Partial<Record<keyof import("@/types/game").SkillMap, number>>;
  unlocksAt?: { generation?: number; netWorthCents?: Cents };
}

/** The pluggable module itself. */
export interface BusinessTypeModule {
  id: BusinessTypeId;
  ui: BusinessUiDescriptor;
  startup: BusinessStartupSpec;

  /** Create a fresh business of this type. */
  create(params: {
    id: Id;
    ownerId: Id;
    name: string;
    locationId: Id;
    tick: Tick;
    seed: string;
  }): Business;

  /** Per-hour tick. Keep this cheap; heavy work belongs in onDay/onWeek. */
  onHour(biz: Business, ctx: BusinessTickContext): BusinessTickResult;

  /** Daily roll-up: restock, damage, morale, payroll accrual. */
  onDay(biz: Business, ctx: BusinessTickContext): BusinessTickResult;

  /** Weekly roll-up: pay wages, pay rent, book profit, taxes. */
  onWeek(biz: Business, ctx: BusinessTickContext): BusinessTickResult;
}
