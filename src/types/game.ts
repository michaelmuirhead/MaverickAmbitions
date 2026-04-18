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
  // v0.9 new categories — bankruptcy / liquidation plumbing
  | "liquidation_proceeds" // cash received from liquidation asset sale (40% of book)
  | "liquidation_writeoff" // book-value loss at closure (negative)
  | "foreclosure_proceeds" // cash received when personal BK foreclosures a property
  | "foreclosure_writeoff" // book-value loss when foreclosed at 90%
  | "debt_discharge" // unsecured debt wiped in personal bankruptcy (positive net)
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
  /**
   * Unsecured personal debt. In v0.9, this accumulates when a business
   * loan collapses to the player's personal guarantee at liquidation. It
   * is discharged (partially or entirely) on personal bankruptcy. Measured
   * in cents; always >= 0.
   */
  personalUnsecuredDebtCents: Cents;
  /**
   * Active bankruptcy lockout flag. Set on personal bankruptcy filing and
   * expires 7 in-game years later (24 ticks × 7 days × 52 weeks × 7 years
   * = 61,152 ticks). While present: no new business loans, doubled down
   * payments on real estate, halved finance-band caps on commercial leases.
   */
  bankruptcyFlag?: {
    filedAtTick: Tick;
    /** Absolute tick after which the flag is considered expired. */
    expiresAtTick: Tick;
  };
  /** Historical record of filed bankruptcies (never cleared). */
  bankruptcyHistory: Array<{
    tick: Tick;
    netWorthAtFilingCents: Cents;
  }>;
  /**
   * Postmortem records for businesses this player has closed (voluntarily
   * or via forced liquidation). Keyed by original business id. Used to
   * render the graveyard view on /business.
   */
  closedBusinesses: Record<Id, ClosedBusinessRecord>;
}

/**
 * Postmortem record stored when a business closes. The source Business
 * record is removed from `game.businesses` and `market.businessIds`, but
 * a summary is preserved here so the player can review what happened.
 */
export interface ClosedBusinessRecord {
  id: Id;
  name: string;
  type: BusinessTypeId;
  marketId: Id;
  openedAtTick: Tick;
  closedAtTick: Tick;
  closedReason:
    | "liquidation" // forced by 4-week insolvency
    | "voluntary_close" // player pressed Close Now
    | "hosted_property_sold"; // player sold the building out from under it
  peakWeeklyRevenueCents: Cents;
  finalCashCents: Cents;
  liquidationProceedsCents: Cents;
  unsecuredDebtFromLoanCents: Cents; // what collapsed to personal
  creditImpact: number; // negative delta to credit score
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

/**
 * Bankruptcy state machine (v0.9).
 *
 * - `operating` — normal state; no cash stress.
 * - `distressed` — cash < −$5,000 at the end of the most recent weekly
 *   tick. Warning banners surface; no mechanical effect yet.
 * - `insolvent` — 4 consecutive weeks distressed; engine will trigger
 *   liquidation on the next weekly tick.
 * - `liquidated` — terminal. The business record is removed from
 *   `game.businesses` on transition to this state; a `ClosedBusinessRecord`
 *   is stored on `player.closedBusinesses` for postmortem.
 *
 * NOTE: The `liquidated` state is never observed on an active Business
 * (the record is deleted when it transitions), but is in the union for
 * clarity and defensive checks.
 */
export type BusinessStatus =
  | "operating"
  | "distressed"
  | "insolvent"
  | "liquidated";

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
  /**
   * Bankruptcy state machine (v0.9). Defaults to "operating". Set to
   * "distressed" on the first week where cash < −$5,000; counted upward
   * in `insolvencyWeeks` while distressed. At 4 consecutive weeks the
   * engine transitions to liquidation.
   *
   * Optional on the type so per-type `createBusiness` factories don't all
   * have to hand-populate them — the store's `openBusiness` action and
   * the v6→v7 save migration backfill both fields centrally. Readers
   * should default to `"operating"` / `0` when absent.
   */
  status?: BusinessStatus;
  /**
   * Count of consecutive weekly ticks with `cash < DISTRESS_THRESHOLD`
   * (−$5,000). Resets to 0 the moment cash recovers above the threshold.
   * v0.9. Optional (see `status` above).
   */
  insolvencyWeeks?: number;
  /** Tick at which this business first entered distressed state (for banners). */
  distressedSince?: Tick;
  /**
   * Shared sales-lever sub-state (v0.10). Replaces the pre-v0.10 per-type
   * `state.marketingWeekly` / `state.marketingScore` scalars and adds
   * hours, promotion, signage, and loyalty knobs. Every storefront /
   * hospitality / cinema business carries a populated LeverState; project-
   * based and service businesses leave it at defaults.
   *
   * Optional on the type so per-type `create()` factories and the v7 → v8
   * migration can both backfill centrally. Readers should fall back to
   * `createDefaultLeverState()` when absent.
   */
  levers?: LeverState;
}

export interface BusinessKPIs {
  weeklyRevenue: Cents;
  weeklyExpenses: Cents;
  weeklyProfit: Cents;
  marketShare: number; // 0..1 in its local market
  customerSatisfaction: number; // 0..100

  // v0.8.1 traffic & conversion instrumentation. Optional because not every
  // business-type engine reports them yet — storefront engines (retail,
  // retailBase) write them each onWeek; project-based / service engines
  // leave them undefined so the UI can show "not tracked for this type."
  /** Total estimated visitors who entered during the completed week. */
  weeklyVisitors?: number;
  /** Total units sold (sum across all SKUs) during the completed week. */
  weeklyUnitsSold?: number;
  /** Conversion rate 0..1 — unitsSold / visitors for the completed week. */
  weeklyConversion?: number;

  /**
   * Peak weekly revenue ever posted by this business (v0.9). Updated on
   * every `onWeek`; used in the closed-business postmortem. Optional
   * because older saves won't carry it until first weekly tick after the
   * v7 migration.
   */
  peakWeeklyRevenue?: Cents;
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

// ---------- Marketing channels (v0.10) ----------

/**
 * Six marketing channels with distinct demographic reach, cost curves,
 * and decay profiles. Replaces the pre-v0.10 scalar `marketingWeekly` on
 * storefront/hospitality/cinema business states.
 *
 * - `radio` — broad-audience, cheap, fast decay
 * - `social` — young-skewed, scales with spend, medium decay
 * - `tv` — older-skewed, expensive, slow decay
 * - `magazines` — affluent-skewed niche reach, slow decay
 * - `ooh` — out-of-home (billboards, transit); location-bound, slow decay
 * - `email` — owned list; near-zero marginal cost, fastest decay if unused
 */
export type MarketingChannel =
  | "radio"
  | "social"
  | "tv"
  | "magazines"
  | "ooh"
  | "email";

/** Convenience generic for per-channel quantities (spend, scores, etc.). */
export type MarketingChannelMap<T = number> = Record<MarketingChannel, T>;

/**
 * Per-channel static profile — the weights that determine how a dollar of
 * spend translates into demographic reach and how the channel's decayed
 * score behaves. Lives in `src/data/marketingChannels.ts`.
 */
export interface MarketingChannelProfile {
  id: MarketingChannel;
  displayName: string;
  /** Emoji / single-char for compact UI rendering. */
  icon: string;
  /** One-sentence description shown as a UI hint. */
  description: string;
  /** −1 (heavy young-skew) .. +1 (heavy old-skew). */
  ageReach: number;
  /** −1 (cheap-only audience) .. +1 (affluent-only). 0 = neutral. */
  incomeReach: number;
  /**
   * $/week at which the channel saturates (in cents). Below this is linear;
   * above this hits diminishing returns.
   */
  saturationCentsPerWeek: Cents;
  /**
   * Per-tick (hourly) score decay multiplier: score *= decayPerTick on
   * every engine tick. Lower value = faster decay.
   */
  decayPerTick: number;
  /**
   * Per-$-spent-per-week score contribution (before demographic weighting)
   * at half-saturation. Used as the "lift" term: score += weeklySpend /
   * saturation × liftAtHalf, clamped at 1.0.
   */
  liftAtHalfSaturation: number;
  /** Minimum weekly spend to register at all (cents). */
  minWeeklyCents: Cents;
}

// ---------- Sales levers (v0.10) ----------

/** 0 = Sunday, 6 = Saturday. Aligned with Date.getDay(). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface DayHours {
  /** 24h clock hour, 0..23. Must be strictly less than close. */
  open: number;
  /** 24h clock hour, 1..24. 24 means midnight roll-over. */
  close: number;
}

/** Per-day hours value. "24h" = open 0-24; "closed" = no hours. */
export type DayHoursValue = DayHours | "closed" | "24h";

export type HoursSchedule = Record<DayOfWeek, DayHoursValue>;

export type SignageTier = "none" | "banner" | "lit" | "digital";

export type LoyaltyTier = "none" | "basic" | "gold";

/**
 * Scheduled store-wide promotion. Applied to every SKU's effective price
 * for the duration; conversion and traffic lift while active; CSAT dip
 * during, small positive bounce for ~4 weeks after (deal memory).
 */
export interface Promotion {
  /** Percent off as a decimal, 0..0.5 (capped at 50%). */
  pctOff: number;
  startTick: Tick;
  endTick: Tick;
  /**
   * Tick until which the post-promo "deal memory" CSAT bump remains active.
   * Set at promo end to endTick + ~4 weeks.
   */
  memoryUntilTick?: Tick;
}

/**
 * Shared sales-lever sub-state. Embedded inside per-type business state
 * on every storefront / hospitality / cinema module. Central helpers in
 * `src/engine/business/leverState.ts` create, tick, and query this shape.
 */
export interface LeverState {
  marketingByChannel: MarketingChannelMap<Cents>;
  marketingScoreByChannel: MarketingChannelMap<number>;
  hours: HoursSchedule;
  signageTier: SignageTier;
  /** Tick the current signage tier was purchased/upgraded. */
  signagePurchasedAt?: Tick;
  /** 0..1 signage freshness; decays very slowly. */
  signageQuality: number;
  loyaltyTier: LoyaltyTier;
  /** 0..1 repeat-customer share. Driven up by loyaltyTier + CSAT. */
  repeatCustomerShare: number;
  promotion: Promotion | null;
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

/**
 * Market demographics (v0.10). Drives per-channel marketing effectiveness
 * via `dot(channelReach, demographics)` in
 * `src/engine/business/marketingChannels.ts`. All 46 STARTER_MARKETS carry
 * hand-tuned demographics; the v7 → v8 save migration copies them from
 * STARTER_MARKETS for older saves.
 */
export interface Demographics {
  /** Median resident age in years (roughly 26..58 across the roster). */
  medianAge: number;
  /** Median household income in cents. Mirrors Market.medianIncome. */
  medianIncome: Cents;
  /** −1 (heavy young-skew) .. +1 (heavy old-skew). 0 = balanced age mix. */
  ageSkew: number;
  /**
   * −1 (tight income distribution — mostly near median)
   * .. +1 (wide income distribution — both extremes present).
   */
  incomeSkew: number;
}

export interface Market {
  id: Id;
  name: string;
  population: number;
  medianIncome: Cents;
  /** 0..1 desirability multiplier that affects rent, traffic, wages. */
  desirability: number;
  /**
   * Extended demographics (v0.10). Used by the channelized-marketing
   * reach model. Optional so v7 → v8 migration can copy from STARTER_MARKETS
   * on hydration. Readers should fall back to STARTER_MARKETS[id].demographics
   * when absent.
   */
  demographics?: Demographics;
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
  /**
   * v0.9. If true, this event should pause any running fast-forward
   * (Day ▸ / Week ▸ / Event ▸) so the player can react. Set on distress
   * warnings, insolvency, macro shock transitions, rival territorial
   * moves, and personal lifecycle events. Non-blocking events (routine
   * payroll, slow-week profit) leave this undefined and allow continued
   * fast-forward under the default pauseOnEvent=\"blocking\" setting.
   */
  blocking?: boolean;
}

/**
 * Game-wide settings. Kept on `GameState` so they travel with saves.
 * v0.9 introduces the first persisted setting; earlier versions had none.
 */
export interface GameSettings {
  /**
   * Controls whether fast-forwards (Day / Week / Event buttons) pause on
   * game events. "all" — any non-dismissed event halts the burst.
   * "blocking" — only events with `blocking: true` halt. "never" — events
   * never halt a fast-forward. Default "blocking".
   */
  pauseOnEvent: "all" | "blocking" | "never";
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
  /**
   * Game-wide settings (v0.9+). Persisted with save so each slot can
   * carry its own preferences.
   */
  settings: GameSettings;
}
