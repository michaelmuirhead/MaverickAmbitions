/**
 * Shared types for Maverick Ambitions.
 *
 * Keep these framework-free (no React, no Next). They describe the
 * simulation and are shared between the engine, state store, and UI.
 */

// ---------- Primitive scalars ----------

/** Money is stored as integer cents to avoid float drift. */
export type Cents = number;

/** Monotonic tick counter; 1 tick = 1 in-game hour. */
export type Tick = number;

/** Stable ID. Created with nanoid. */
export type Id = string;

// ---------- Time ----------

export type GameSpeed = 0 | 1 | 2 | 4 | 8;

export interface GameClock {
  /** Total ticks elapsed since new-game. */
  tick: Tick;
  /** Wall-clock ms at which the current tick was computed. */
  lastStepAt: number;
  /** Paused (speed 0) vs running. */
  speed: GameSpeed;
}

// ---------- Macro economy ----------

export type MacroPhase =
  | "recovery"
  | "expansion"
  | "peak"
  | "contraction"
  | "trough";

export interface MacroState {
  phase: MacroPhase;
  /** 0..1, within-cycle progress. */
  phaseProgress: number;
  /** Annualized interest rate as a decimal (e.g. 0.045). */
  interestRate: number;
  /** Consumer wallet multiplier (~0.85..1.15). */
  consumerWallet: number;
  /** Real-estate multiplier (~0.7..1.6 over cycles). */
  realEstateMultiplier: number;
  /** Sticky drift of labor cost. */
  laborCostMultiplier: number;
}

// ---------- Finance ----------

export type LoanKind =
  | "personal" // generic unsecured line
  | "mortgage" // secured by a property
  | "business"; // working-capital / SBA-style

export interface Loan {
  id: Id;
  kind?: LoanKind; // optional for back-compat; defaults to "personal"
  principal: Cents;
  balance: Cents;
  annualRate: number;
  termMonths: number;
  monthlyPayment: Cents;
  takenAtTick: Tick;
  /** For mortgages. Links back to the Property this loan secures. */
  propertyId?: Id;
  /** For mortgages. The down payment actually paid up front. */
  downPaymentCents?: Cents;
  /** For business loans. Links back to the Business this loan financed. */
  businessId?: Id;
  /** Per-loan payment history flag (last N months). Used to nudge credit. */
  missedPaymentsThisYear?: number;
}

// ---------- Real estate ----------

export type PropertyClass = "C" | "B" | "A" | "trophy";

export interface Property {
  id: Id;
  marketId: Id;
  /** Street-level descriptor, e.g. "12 Harbor Ln". */
  address: string;
  class: PropertyClass;
  /** Square feet of usable retail/office space. */
  sqft: number;
  /** Current appraised value (cents). Refreshed monthly. */
  valueCents: Cents;
  /** Price the current owner paid (cents). 0 if never transacted (landlord-held). */
  purchasePriceCents: Cents;
  /** Tick the current owner bought at. */
  purchaseTick?: Tick;
  /** Player, rival, or omitted (= absentee landlord pool). */
  ownerId?: Id;
  /** If currently hosting a business, that business id. */
  hostedBusinessId?: Id;
  /** Listed for sale right now? If so, this is the ask price. */
  listPriceCents?: Cents;
  /** Listed for rent right now? If so, this is the monthly rent ask. */
  listRentCents?: Cents;
  /** Mortgage id if financed. */
  mortgageId?: Id;
  /** Monthly maintenance carry (cents) — ongoing regardless of occupancy. */
  maintenanceMonthlyCents: Cents;
}

export interface LedgerEntry {
  id: Id;
  tick: Tick;
  amount: Cents; // signed (+ revenue / asset, - expense / liability)
  category: LedgerCategory;
  memo: string;
  businessId?: Id;
}

export type LedgerCategory =
  | "revenue"
  | "cogs"
  | "wages"
  | "rent"
  | "utilities"
  | "marketing"
  | "tax"
  | "loan_payment"
  | "loan_proceeds"
  | "inventory_purchase"
  | "capex"
  | "personal"
  | "property_purchase"
  | "property_sale"
  | "property_maintenance"
  | "mortgage_interest"
  | "mortgage_principal"
  | "business_loan_proceeds"
  | "business_loan_interest"
  | "business_loan_principal"
  | "rent_income"
  | "tips"
  | "license_fee"
  | "event_marker"
  // v0.8 new categories
  | "cover_charge" // nightclub door / VIP
  | "project_billing" // construction, tech_startup, gaming_studio, movie_studio, military_tech
  | "project_cost"
  | "vc_proceeds" // tech_startup / gaming_studio external funding
  | "royalties" // gaming_studio DLC, movie_studio streaming residuals
  | "box_office" // cinema ticket sales, movie_studio theatrical
  | "concessions" // cinema candy/popcorn
  | "insurance_billing" // hospital_clinic
  | "malpractice_settlement" // hospital_clinic
  | "property_management_fee" // real_estate_firm
  | "flip_gain" // real_estate_firm flip margin
  | "commodity_sale" // oil_gas wellhead sales
  | "drilling_capex" // oil_gas new-well capex
  | "gov_contract" // military_tech
  | "rd_spend" // military_tech + tech startup R&D
  | "other";

// ---------- Player ----------

export interface SkillMap {
  management: number;
  negotiation: number;
  finance: number;
  charisma: number;
  tech: number;
  operations: number;
}

export interface NeedMap {
  sleep: number;
  social: number;
  family: number;
  leisure: number;
  status: number;
}

export interface PlayerCharacter {
  id: Id;
  name: string;
  age: number;
  health: number; // 0..100
  energy: number; // 0..100
  reputation: number; // -100..100
  skills: SkillMap;
  needs: NeedMap;
  /** Cash on hand, personal. Distinct from any business cash. */
  personalCash: Cents;
  creditScore: number; // 300..850
  /** Active loans against the player personally. */
  personalLoans: Loan[];
  /** Family member IDs. */
  spouseId?: Id;
  childrenIds: Id[];
  parentIds: Id[]; // previous generation (for dynasty tree)
  generation: number; // 1 = founder
  alive: boolean;
  birthTick: Tick;
  deathTick?: Tick;
}

// ---------- Family ----------

export interface FamilyMember {
  id: Id;
  name: string;
  age: number;
  role: "spouse" | "child" | "parent" | "sibling";
  traits: Partial<SkillMap>;
  affinity: number; // -100..100 with the current head of household
  alive: boolean;
  /** Optional link to a playable PlayerCharacter once this member takes over. */
  promotesToPlayerId?: Id;
}

// ---------- Business ----------

export type BusinessTypeId =
  // Food & hospitality
  | "corner_store"
  | "cafe"
  | "bar"
  | "restaurant"
  | "food_truck"
  | "pizza_shop"
  | "nightclub"
  // Retail family (share one parameterized engine)
  | "bookstore"
  | "electronics_store"
  | "florist"
  | "supermarket"
  | "jewelry_store"
  | "clothing_retail"
  | "suit_store"
  | "furniture_store"
  // Entertainment
  | "cinema"
  | "movie_studio"
  // Project-based / knowledge work
  | "tech_startup"
  | "gaming_studio"
  | "construction"
  // Services
  | "hospital_clinic"
  | "real_estate_firm"
  // Heavy industry
  | "oil_gas"
  | "military_tech"
  // Civic scale (far-future — unimplemented)
  | "sports_team"
  | "city"
  | "state"
  | "nation";

export interface Business {
  id: Id;
  ownerId: Id; // PlayerCharacter or AIRival id
  type: BusinessTypeId;
  name: string;
  locationId: Id;
  openedAtTick: Tick;
  cash: Cents;
  /** Type-specific state (inventory, staff, roster, etc.). */
  state: Record<string, unknown>;
  kpis: BusinessKPIs;
  /** Per-tick cached derived values the UI can read. */
  derived: BusinessDerived;
  /** If set, this business operates from an owned Property (v0.3+). */
  propertyId?: Id;
}

export interface BusinessKPIs {
  weeklyRevenue: Cents;
  weeklyExpenses: Cents;
  weeklyProfit: Cents;
  marketShare: number; // 0..1 in its local market
  customerSatisfaction: number; // 0..100
}

export interface BusinessDerived {
  /** Last tick foot traffic visiting. */
  footTraffic: number;
  /** 0..1 visible stock level. */
  stockLevel: number;
  /** Wages owed at end of week (cents). */
  pendingWages: Cents;
  /** Risk score 0..100 — theft, audit, burnout, etc. */
  riskScore: number;
}

// ---------- Region ----------

/**
 * A Region is a geographic container for Markets — e.g. "Maverick County,
 * NY" (the v0.7.3 launch setting). Regions are the forward-looking unit
 * that future versions will grow the map with: NYC boroughs, Long Island,
 * and New Jersey in Phase 2; major US metros (LA County, Cook County,
 * Miami-Dade, etc.) in Phase 3, where region-level mechanics such as
 * sports-team ownership and political office come online. For v0.7.3 the
 * game ships with exactly one active Region; the architecture exists so
 * adding more is a data change rather than a refactor.
 */
export interface Region {
  id: Id;
  /** Display name, including state. e.g. "Maverick County, NY". */
  name: string;
  /** ISO-ish country tag. All v0.7.3 regions are "US". */
  country: string;
  /** Short positioning line surfaced in UI headers. */
  tagline: string;
  /**
   * Long-form summary shown on a Region detail view. Multiple sentences
   * of flavor copy establishing the setting and its geography.
   */
  summary: string;
  /** Markets that live inside this region (by Market.id). */
  marketIds: Id[];
  /**
   * Whether the region is playable in the current version. Only the v0.7.3
   * launch region (`r_maverick_county_ny`) is active; Phase 2/3 entries
   * will land here as `active: false` until their features ship.
   */
  active: boolean;
}

// ---------- Market ----------

export interface Market {
  id: Id;
  name: string;
  population: number;
  medianIncome: Cents;
  /** 0..1 desirability multiplier that affects rent, traffic, wages. */
  desirability: number;
  /**
   * One-to-two-sentence flavor description surfaced in the MarketPage UI.
   * Establishes neighborhood character within the game's setting
   * (Maverick County, NY — a fictional county on NYC's outskirts).
   *
   * Optional because old saves migrated in from v0.7.2 won't carry it on
   * the `Market` records they persisted; selectors / UI should fall back
   * to the live `STARTER_MARKETS` description when a save's record is
   * missing it.
   */
  description?: string;
  /**
   * The Region this market belongs to. Always populated on fresh markets
   * and on v5 → v6 migrated saves (all pre-v0.7.3 markets retroactively
   * belong to Maverick County).
   */
  regionId: Id;
  /** Business IDs operating in this market (player + rivals). */
  businessIds: Id[];
}

// ---------- AI Rivals ----------

export type RivalPersonality =
  | "predator"
  | "tycoon"
  | "operator"
  | "disruptor"
  | "politician";

export interface AIRival {
  id: Id;
  name: string;
  personality: RivalPersonality;
  difficulty: 1 | 2 | 3 | 4 | 5;
  netWorth: Cents;
  businessIds: Id[];
  /** Remembered grudges / favors with the player. -100..100 */
  stance: number;
  /** Last weekly plan. */
  lastMove?: {
    tick: Tick;
    description: string;
  };
}

// ---------- Macro events (v0.5 shocks) ----------

/**
 * A macro event is a timed pulse that modifies the macro signals + causes
 * rival reactions. Defined statically in `src/data/macroEvents.ts`; what's
 * stored on `GameState` is an activation record (ActiveMacroEvent) plus a
 * rolling history for cooldown tracking.
 */
export type MacroEventId =
  | "rate_spike"
  | "rate_cut"
  | "recession_fears"
  | "consumer_boom"
  | "housing_downturn"
  | "housing_rally"
  | "liquor_tax_hike"
  | "viral_food_trend"
  | "commodity_shortage"
  | "labor_scarcity";

export type MacroEventCategory =
  | "rates"
  | "wallet"
  | "realestate"
  | "hospitality"
  | "cogs"
  | "labor";

export type MacroEventSeverity = "mild" | "strong";

export type MacroEventTone = "positive" | "negative" | "mixed";

export interface MacroEventDef {
  id: MacroEventId;
  category: MacroEventCategory;
  title: string;
  detail: string;
  /** Duration in ticks (1 tick = 1 hour). */
  durationTicks: Tick;
  /** Severity knob — stronger pulses. */
  severity: MacroEventSeverity;
  /** Player-visible direction (for banner color). */
  tone: MacroEventTone;
  /**
   * Pulse deltas applied additively on top of the baseline macro signal
   * while active. Each field is optional.
   */
  pulse: {
    /** Added to macro.interestRate (decimal, e.g. +0.015 = +1.5%). */
    interestRateDelta?: number;
    /** Multiplier applied to macro.consumerWallet (e.g. 0.88 = -12%). */
    consumerWalletMul?: number;
    /** Multiplier applied to macro.realEstateMultiplier. */
    realEstateMul?: number;
    /** Multiplier applied to macro.laborCostMultiplier. */
    laborCostMul?: number;
    /** Multiplier on all COGS this tick (sim reads via getCogsMultiplier). */
    cogsMul?: number;
    /** Multiplier on liquor license fees (bars + restaurants). */
    liquorLicenseFeeMul?: number;
    /** Per-type traffic boost (e.g. viral trend: { restaurant: 1.2 }). */
    trafficMulByType?: Partial<Record<BusinessTypeId, number>>;
  };
  /**
   * Weekly roll weight used for scheduling. Higher = more likely to fire
   * when the weekly event roll hits.
   */
  weight: number;
  /** Ticks of cooldown after an activation expires before it can re-roll. */
  cooldownTicks: Tick;
}

export interface ActiveMacroEvent {
  /** Unique activation ID — distinct from defId, because one def can activate multiple times across a long game. */
  id: Id;
  defId: MacroEventId;
  startTick: Tick;
  endTick: Tick;
  /** Optional notes about this specific activation (e.g. random severity multiplier). */
  note?: string;
}

export interface MacroEventHistoryEntry {
  defId: MacroEventId;
  startTick: Tick;
  endTick: Tick;
}

// ---------- Events ----------

export type GameEventKind =
  | "macro_shock"
  | "macro_shock_end"
  | "business_event"
  | "personal_event"
  | "rival_move"
  | "family_event"
  | "audit"
  | "milestone";

export interface GameEvent {
  id: Id;
  tick: Tick;
  kind: GameEventKind;
  title: string;
  detail: string;
  impact?: {
    cashDelta?: Cents;
    reputationDelta?: number;
  };
  dismissed: boolean;
}

// ---------- Top-level save shape ----------

export interface GameState {
  version: number;
  seed: string;
  clock: GameClock;
  macro: MacroState;
  player: PlayerCharacter;
  family: Record<Id, FamilyMember>;
  businesses: Record<Id, Business>;
  markets: Record<Id, Market>;
  /**
   * Regions containing the markets. v0.7.3 ships with exactly one active
   * region (`r_maverick_county_ny`); Phase 2/3 will add NYC boroughs, Long
   * Island, New Jersey, then national metros. Region-scoped mechanics
   * (sports teams, political office) will hang off this map in later
   * versions, which is why it is persisted per-save rather than read-only.
   */
  regions: Record<Id, Region>;
  rivals: Record<Id, AIRival>;
  /** All real-estate properties across every market, keyed by id. */
  properties: Record<Id, Property>;
  /** All outstanding mortgages (player + rival), keyed by loan id. */
  mortgages: Record<Id, Loan>;
  /** All outstanding business-startup loans (v0.5.1), keyed by loan id. */
  businessLoans: Record<Id, Loan>;
  ledger: LedgerEntry[];
  events: GameEvent[];
  /** Currently-active macro events (pulse effects applied to macro signals). */
  activeEvents: ActiveMacroEvent[];
  /** Completed activations, for cooldown tracking. Capped to last 32 entries. */
  eventHistory: MacroEventHistoryEntry[];
  /** Global counters that survive generations. */
  dynasty: {
    generations: number;
    cumulativeNetWorth: Cents;
    philanthropy: Cents;
    influence: number;
  };
}
