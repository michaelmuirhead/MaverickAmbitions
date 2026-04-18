/**
 * Cinema — multi-screen programming + concessions + streaming pressure.
 *
 * Distinctive mechanics vs retail/hospitality:
 *   - Revenue has two very different channels. Box office is the
 *     headline number but concessions (popcorn, candy, soda) carry
 *     the margin. The popcorn:ticket ratio is where the money is.
 *   - Each screen runs ~6 shows/day. Per-show attendance is capacity
 *     × utilization, with utilization driven by:
 *       film quality × opening-week bonus × day-of-week
 *       × (1 − streaming pressure) × marketing × demand.
 *   - Films age out. Each film has an openedAtTick and decays over
 *     ~4 weeks; the module auto-rotates programming weekly so the
 *     player isn't forced to micromanage release slates.
 *   - Streaming pressure is an ambient drag (0.2..0.45) that grows
 *     slowly week over week — cinemas need concession profit,
 *     premium formats, and marketing to stay ahead of it.
 *
 * Strategic shape:
 *   $260K startup, unlocks at $200K NW. High fixed costs (4 screens
 *   of rent), cyclical (summer + holidays peak), but concession
 *   margins are 85%+ so a busy weekend prints money.
 */

import type {
  Business,
  BusinessDerived,
  BusinessKPIs,
  Cents,
  Id,
  LedgerEntry,
  Tick,
} from "@/types/game";

import { getHours, getMonth } from "date-fns";

import { dayOfWeek, tickToDate } from "@/lib/date";
import { dollars } from "@/lib/money";
import { createRng } from "@/lib/rng";

import { ECONOMY } from "../economy/constants";
import { corporateTax, ledger } from "../economy/finance";
import { getPulseBundle } from "../macro/events";
import { marketFootTraffic } from "../economy/market";

import {
  currentPromoPctOff,
  effectiveMarketingScore,
  hourlyWageMultiplier,
  hoursCsatBonus,
  isBusinessOpenNow,
  leversOf,
  promotionCsatDelta,
  promotionTrafficLift,
  totalWeeklyMarketing,
} from "./leverState";

import type {
  BusinessStartupSpec,
  BusinessTickContext,
  BusinessTickResult,
  BusinessTypeModule,
  BusinessUiDescriptor,
} from "./types";

// ---------- Config ----------

const OPERATING_START = 10; // 10am
const OPERATING_END = 23; // last showing ~11pm

// Film runtime slate — film auto-rotates off after ~28 days.
const FILM_LIFETIME_DAYS = 28;

// Seasonality — summer + holiday peaks for box office (12 months, Jan..Dec).
const CINEMA_SEASONALITY = [
  0.95, 0.85, 0.95, 0.95, 1.05, 1.25,  // Jan..Jun
  1.35, 1.25, 0.95, 0.95, 1.1, 1.25,   // Jul..Dec
] as const;

// ---------- State ----------

type Genre = "action" | "drama" | "comedy" | "horror" | "family" | "scifi";

interface FilmSlot {
  id: Id;
  title: string;
  genre: Genre;
  /** 0..1 inherent film quality (distributor scores, critics). */
  quality: number;
  /** When we first started showing it. Drives decay. */
  openedAtTick: Tick;
  /** Per-film booking cost weekly (distributor share). */
  distributorSharePct: number; // 0.45..0.65 typical
}

interface Screen {
  id: Id;
  /** Seats per show. */
  capacity: number;
  /** Current film programmed on this screen. null = dark. */
  film: FilmSlot | null;
  /** 0..1 condition. Degrades; dirty screens lose patrons. */
  condition: number;
  /** Premium-format? (IMAX/Dolby). Adds ticket price premium + halo. */
  premium: boolean;
}

interface CinemaStaff {
  id: Id;
  name: string;
  role: "projectionist" | "usher" | "concessions" | "manager";
  hourlyWageCents: Cents;
  skill: number;
  morale: number;
}

export interface CinemaState {
  screens: Screen[];
  ticketPriceCents: Cents;
  ticketPricePremiumBonus: Cents;
  concessionAvgSpend: Cents;
  /** Fraction of attendees that buy concessions. */
  concessionAttachRate: number;
  /** 0..1 ambient streaming-service demand drag. */
  streamingPressure: number;
  rentMonthly: Cents;
  staff: CinemaStaff[];

  // accumulators
  weeklyBoxOfficeAcc: Cents;
  weeklyConcessionsAcc: Cents;
  weeklyDistributorAcc: Cents;
  weeklyCogsAcc: Cents;
  wagesAccrued: Cents;
  weeklyAdmissionsAcc: number;

  // per-day idempotency for book-keeping
  lastRotatedOnDayIndex: number;
}

// ---------- UI / startup ----------

const ui: BusinessUiDescriptor = {
  label: "Cinema",
  icon: "🎬",
  kpiLabels: [
    "Weekly Profit",
    "Box Office",
    "Concessions",
    "Streaming Pressure",
  ],
  sections: ["screens", "staff", "marketing"],
};

const startup: BusinessStartupSpec = {
  startupCostCents: dollars(260_000),
  minimumCreditScore: 680,
  unlocksAt: { netWorthCents: dollars(200_000) },
};

// ---------- Helpers ----------

function hourOf(tick: Tick): number {
  return getHours(tickToDate(tick));
}

function monthOf(tick: Tick): number {
  return getMonth(tickToDate(tick));
}

function isOperatingHour(tick: Tick): boolean {
  const h = hourOf(tick);
  return h >= OPERATING_START && h <= OPERATING_END;
}

// Day-of-week multiplier for cinema attendance (Mon..Sun).
const DOW_MULTIPLIER: Record<number, number> = {
  0: 0.85, // Sun
  1: 0.65, // Mon
  2: 0.65, // Tue
  3: 0.75, // Wed
  4: 0.85, // Thu
  5: 1.15, // Fri
  6: 1.25, // Sat
};

/** Per-hour curve for screenings — peaks at 19:00-21:00. */
function hourAttendanceCurve(h: number): number {
  if (h < OPERATING_START || h > OPERATING_END) return 0;
  if (h >= 19 && h <= 21) return 1.0;
  if (h === 18 || h === 22) return 0.85;
  if (h === 17 || h === 23) return 0.6;
  if (h >= 14 && h <= 16) return 0.45;
  return 0.28; // matinees
}

/** Film age decay: new film week 1 = 1.0, week 4 ≈ 0.25, dies at ~28 days. */
function filmAgeMul(film: FilmSlot, tick: Tick): number {
  const ageHours = Math.max(0, tick - film.openedAtTick);
  const ageDays = ageHours / 24;
  if (ageDays <= 7) return 1.0 - ageDays * 0.02; // slow opening-week decay
  if (ageDays <= 14) return 0.85 - (ageDays - 7) * 0.05;
  if (ageDays <= 21) return 0.5 - (ageDays - 14) * 0.035;
  if (ageDays <= FILM_LIFETIME_DAYS) return Math.max(0.15, 0.26 - (ageDays - 21) * 0.01);
  return 0; // expired
}

function rollNewFilm(
  tick: Tick,
  seed: string,
  rngLabel: string,
  rng: import("@/lib/rng").RNG,
): FilmSlot {
  const genres: Genre[] = ["action", "drama", "comedy", "horror", "family", "scifi"];
  const genre = genres[rng.nextInt(0, genres.length - 1)] ?? "drama";
  const titles: Record<Genre, string[]> = {
    action: ["Velocity", "Hard Target", "Chrome Strike", "Ironborn"],
    drama: ["Quiet Fields", "The Long Call", "A Crowded Silence", "Still Water"],
    comedy: ["The Accidental Tenant", "Uncle Ramen", "Third Wheel", "Honk"],
    horror: ["The Hollow", "Night Bus", "Lockjaw", "The Cold House"],
    family: ["Pebble & Paw", "Kite Summer", "Tiny Sailors", "The Lantern"],
    scifi: ["Perihelion", "Signal Drift", "Orbital Decay", "The Last Seed"],
  };
  const pool = titles[genre];
  const title = pool[rng.nextInt(0, pool.length - 1)] ?? "Unknown";
  const quality = Math.max(0.15, Math.min(0.95, 0.5 + rng.nextFloat(-0.3, 0.35)));
  const distributorSharePct = 0.45 + rng.nextFloat(0, 0.2);
  return {
    id: `${seed}-${rngLabel}-${tick}`,
    title,
    genre,
    quality,
    openedAtTick: tick,
    distributorSharePct,
  };
}

// ---------- Factory ----------

function createBusiness(params: {
  id: Id;
  ownerId: Id;
  name: string;
  locationId: Id;
  tick: Tick;
  seed: string;
}): Business {
  const state: CinemaState = {
    screens: [
      { id: `${params.id}-s1`, capacity: 180, film: null, condition: 0.95, premium: true },
      { id: `${params.id}-s2`, capacity: 140, film: null, condition: 0.95, premium: false },
      { id: `${params.id}-s3`, capacity: 120, film: null, condition: 0.95, premium: false },
      { id: `${params.id}-s4`, capacity: 100, film: null, condition: 0.95, premium: false },
    ],
    ticketPriceCents: dollars(14),
    ticketPricePremiumBonus: dollars(5),
    concessionAvgSpend: dollars(12),
    concessionAttachRate: 0.65,
    streamingPressure: 0.3,
    rentMonthly: Math.round(ECONOMY.BASE_RENT_MONTHLY_CENTS * 4), // multiplex footprint
    staff: [
      { id: `${params.id}-mgr`,  name: "General Manager",  role: "manager",      hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.5), skill: 60, morale: 72 },
      { id: `${params.id}-pj1`,  name: "Projectionist",    role: "projectionist", hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.2), skill: 55, morale: 70 },
      { id: `${params.id}-us1`,  name: "Usher Alpha",      role: "usher",        hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 0.95), skill: 45, morale: 68 },
      { id: `${params.id}-us2`,  name: "Usher Beta",       role: "usher",        hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 0.95), skill: 45, morale: 68 },
      { id: `${params.id}-cn1`,  name: "Concessions Lead", role: "concessions",  hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 1.0),  skill: 55, morale: 72 },
      { id: `${params.id}-cn2`,  name: "Concessions",      role: "concessions",  hourlyWageCents: Math.round(ECONOMY.BASE_HOURLY_WAGE_CENTS * 0.95), skill: 45, morale: 68 },
    ],

    weeklyBoxOfficeAcc: 0,
    weeklyConcessionsAcc: 0,
    weeklyDistributorAcc: 0,
    weeklyCogsAcc: 0,
    wagesAccrued: 0,
    weeklyAdmissionsAcc: 0,

    lastRotatedOnDayIndex: -1,
  };

  // Seed initial programming — each screen gets a film.
  const seedRng = createRng(`${params.seed}-cinema-seed`);
  for (let i = 0; i < state.screens.length; i++) {
    const screen = state.screens[i];
    if (screen)
      screen.film = rollNewFilm(
        params.tick,
        params.seed,
        `seed${i}`,
        seedRng.child(`s${i}`),
      );
  }

  const kpis: BusinessKPIs = {
    weeklyRevenue: 0,
    weeklyExpenses: 0,
    weeklyProfit: 0,
    marketShare: 0.18,
    customerSatisfaction: 68,
  };

  const derived: BusinessDerived = {
    footTraffic: 0,
    stockLevel: 1,
    pendingWages: 0,
    riskScore: 20,
  };

  return {
    id: params.id,
    ownerId: params.ownerId,
    type: "cinema",
    name: params.name,
    locationId: params.locationId,
    openedAtTick: params.tick,
    cash: dollars(22_000),
    state: state as unknown as Record<string, unknown>,
    kpis,
    derived,
  };
}

// ---------- Simulation ----------

function getState(biz: Business): CinemaState {
  return structuredClone(biz.state) as unknown as CinemaState;
}

function avgService(state: CinemaState): number {
  if (state.staff.length === 0) return 0;
  return (
    state.staff.reduce((a, s) => a + (s.skill * s.morale) / 10000, 0) /
    state.staff.length
  );
}

function onHour(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const market = ctx.world.markets[biz.locationId];
  const ledgerEntries: LedgerEntry[] = [];

  // v0.10: intersect the type's natural operating window with the
  // player's schedule so overrides like "closed Mondays" apply.
  if (
    !market ||
    !isOperatingHour(ctx.tick) ||
    !isBusinessOpenNow(biz, ctx.tick) ||
    state.staff.length === 0
  ) {
    return { business: updateDerivedOnly(biz, state), ledger: [], events: [] };
  }

  const pulse = getPulseBundle(ctx.world.activeEvents ?? []);
  const hourCurve = hourAttendanceCurve(hourOf(ctx.tick));
  const dowMul = DOW_MULTIPLIER[dayOfWeek(ctx.tick)] ?? 1;
  const seasonMul = CINEMA_SEASONALITY[monthOf(ctx.tick)] ?? 1;
  const service = avgService(state);
  const marketingScore = effectiveMarketingScore(leversOf(biz), market);

  // v0.10: active promotion boosts admissions (+up to 40%) and discounts tickets.
  const promo = leversOf(biz).promotion;
  const promoDisc = currentPromoPctOff(promo, ctx.tick);
  const trafficLift = promotionTrafficLift(promo, ctx.tick);
  const rawTraffic = marketFootTraffic(market, ctx.macro, ctx.tick) * trafficLift;
  const streamingDrag = 1 - state.streamingPressure;

  let hourAdmissions = 0;
  let hourBoxOffice = 0;
  let hourConcessions = 0;
  let hourDistributor = 0;
  let hourCogs = 0;

  for (const screen of state.screens) {
    if (!screen.film) continue;
    const film = screen.film;
    const ageMul = filmAgeMul(film, ctx.tick);
    if (ageMul <= 0) continue;

    // Utilization per screen.
    const premiumHalo = screen.premium ? 1.1 : 1.0;
    const quality = film.quality;
    const utilization = Math.max(
      0,
      Math.min(
        0.95,
        hourCurve *
          dowMul *
          seasonMul *
          ageMul *
          (0.55 + quality * 0.5) *
          (0.7 + marketingScore * 0.5) *
          (0.75 + service * 0.35) *
          streamingDrag *
          premiumHalo *
          (0.45 + rawTraffic / 120),
      ),
    );

    const admissions = Math.round(screen.capacity * utilization * screen.condition);
    if (admissions <= 0) continue;

    const ticketPriceBase = state.ticketPriceCents + (screen.premium ? state.ticketPricePremiumBonus : 0);
    const ticketPrice = Math.max(1, Math.round(ticketPriceBase * (1 - promoDisc)));
    const boxOffice = admissions * ticketPrice;
    const distributorShare = Math.round(boxOffice * film.distributorSharePct);

    const concessionBuyers = Math.round(admissions * state.concessionAttachRate);
    const concessionRevenue = concessionBuyers * state.concessionAvgSpend;
    const concessionCogs = Math.round(concessionRevenue * 0.18 * pulse.cogsMultiplier);

    hourAdmissions += admissions;
    hourBoxOffice += boxOffice;
    hourConcessions += concessionRevenue;
    hourDistributor += distributorShare;
    hourCogs += concessionCogs;

    // Condition wears slowly.
    screen.condition = Math.max(0.4, screen.condition - 0.00008 * admissions);
  }

  if (hourBoxOffice > 0) {
    ledgerEntries.push(
      ledger(
        `box-${biz.id}-${ctx.tick}`,
        ctx.tick,
        hourBoxOffice,
        "box_office",
        "Box office",
        biz.id,
      ),
    );
  }
  if (hourDistributor > 0) {
    ledgerEntries.push(
      ledger(
        `dist-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -hourDistributor,
        "cogs",
        "Distributor share",
        biz.id,
      ),
    );
  }
  if (hourConcessions > 0) {
    ledgerEntries.push(
      ledger(
        `cnc-${biz.id}-${ctx.tick}`,
        ctx.tick,
        hourConcessions,
        "concessions",
        "Concessions",
        biz.id,
      ),
    );
  }
  if (hourCogs > 0) {
    ledgerEntries.push(
      ledger(
        `ccogs-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -hourCogs,
        "cogs",
        "Concession COGS",
        biz.id,
      ),
    );
  }

  // Wages accrue. Graveyard hours (before 6am or 22:00+) pay a 1.25× premium.
  const wageMul = hourlyWageMultiplier(ctx.tick);
  const wagesThisHour = Math.round(
    state.staff.reduce((a, s) => a + s.hourlyWageCents, 0) * wageMul,
  );
  state.wagesAccrued += wagesThisHour;

  state.weeklyBoxOfficeAcc += hourBoxOffice;
  state.weeklyConcessionsAcc += hourConcessions;
  state.weeklyDistributorAcc += hourDistributor;
  state.weeklyCogsAcc += hourCogs;
  state.weeklyAdmissionsAcc += hourAdmissions;

  const revenue = hourBoxOffice + hourConcessions;
  const expense = hourDistributor + hourCogs;
  const newCash = biz.cash + revenue - expense;

  const updated: Business = {
    ...biz,
    cash: newCash,
    state: state as unknown as Record<string, unknown>,
    derived: {
      ...biz.derived,
      footTraffic: hourAdmissions,
      stockLevel: 1,
      pendingWages: state.wagesAccrued,
      riskScore: Math.max(
        0,
        Math.min(100, Math.round(20 + state.streamingPressure * 50 - service * 20)),
      ),
    },
  };

  return { business: updated, ledger: ledgerEntries, events: [] };
}

function onDay(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  // Staff drift.
  for (const s of state.staff) {
    s.morale = Math.max(0, Math.min(100, s.morale + ctx.rng.nextFloat(-2, 2)));
    s.skill = Math.min(100, s.skill + ctx.rng.nextFloat(0, 0.15));
  }

  // Streaming pressure drifts up slowly — structural cinema headwind.
  // Capped at 0.6.
  if (ctx.rng.chance(0.08)) {
    state.streamingPressure = Math.min(0.6, state.streamingPressure + 0.003);
  }

  // Retire any expired films.
  for (const screen of state.screens) {
    if (screen.film && filmAgeMul(screen.film, ctx.tick) <= 0) {
      screen.film = null;
    }
  }

  return {
    business: { ...biz, state: state as unknown as Record<string, unknown> },
    ledger: [],
    events: [],
  };
}

function onWeek(biz: Business, ctx: BusinessTickContext): BusinessTickResult {
  const state = getState(biz);
  const ledgerEntries: LedgerEntry[] = [];
  const events: BusinessTickResult["events"] = [];
  let cash = biz.cash;

  // Rotate empty screens with fresh films.
  const rng = ctx.rng.child("film-rotate");
  for (let i = 0; i < state.screens.length; i++) {
    const screen = state.screens[i];
    if (!screen) continue;
    // Also rotate any film that's at least 3 weeks in — freshness helps draw.
    const needsNew =
      !screen.film ||
      (screen.film && (ctx.tick - screen.film.openedAtTick) / 24 >= 21);
    if (needsNew) {
      screen.film = rollNewFilm(ctx.tick, biz.id, `r${i}`, rng);
      events.push({
        kind: "business_event",
        title: `${biz.name} booked “${screen.film.title}”`,
        detail: `New ${screen.film.genre} opening on screen ${i + 1}.`,
      });
    }
  }

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

  // Marketing — channelized spend.
  const weeklyMarketing = totalWeeklyMarketing(leversOf(biz));
  if (weeklyMarketing > 0) {
    cash -= weeklyMarketing;
    ledgerEntries.push(
      ledger(
        `mkt-${biz.id}-${ctx.tick}`,
        ctx.tick,
        -weeklyMarketing,
        "marketing",
        "Marketing",
        biz.id,
      ),
    );
  }

  const weeklyRevenue = state.weeklyBoxOfficeAcc + state.weeklyConcessionsAcc;
  const weeklyExpenses =
    state.weeklyDistributorAcc +
    state.weeklyCogsAcc +
    state.wagesAccrued +
    weeklyRent +
    weeklyMarketing;
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
  const concessionShare =
    weeklyRevenue > 0 ? state.weeklyConcessionsAcc / weeklyRevenue : 0;
  const csatMarketingScore = effectiveMarketingScore(
    leversOf(biz),
    ctx.world.markets[biz.locationId],
  );
  const hoursBonus = hoursCsatBonus(leversOf(biz).hours);
  // v0.10: active promo bleeds CSAT; memory window gives a small post-promo bump.
  const promoDelta = promotionCsatDelta(leversOf(biz).promotion, ctx.tick);
  const target =
    55 +
    csatMarketingScore * 10 +
    (concessionShare > 0.35 ? 6 : 0) +
    (state.streamingPressure > 0.45 ? -6 : 0) +
    hoursBonus;
  const next =
    biz.kpis.customerSatisfaction +
    (Math.max(0, Math.min(90, target)) - biz.kpis.customerSatisfaction) * 0.18 +
    promoDelta;

  // Reset weekly.
  state.weeklyBoxOfficeAcc = 0;
  state.weeklyConcessionsAcc = 0;
  state.weeklyDistributorAcc = 0;
  state.weeklyCogsAcc = 0;
  state.wagesAccrued = 0;
  state.weeklyAdmissionsAcc = 0;

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

function updateDerivedOnly(biz: Business, state: CinemaState): Business {
  return {
    ...biz,
    derived: { ...biz.derived, pendingWages: state.wagesAccrued },
    state: state as unknown as Record<string, unknown>,
  };
}

// ---------- Module ----------

export const cinemaModule: BusinessTypeModule = {
  id: "cinema",
  ui,
  startup,
  create: createBusiness,
  onHour,
  onDay,
  onWeek,
};
