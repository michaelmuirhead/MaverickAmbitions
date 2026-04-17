/**
 * Real estate engine.
 *
 * Properties are an optional ownership layer on top of the rent-only
 * v0.2 world. A business can either:
 *   - rent (no equity, current behavior, uses its `rentMonthly` state)
 *   - sit on an owned property (carries a mortgage + maintenance, no rent,
 *     builds equity, appreciates/depreciates with the market)
 *
 * This module provides:
 *   - seed-time property generation per market
 *   - valuation + monthly appreciation walk
 *   - credit spread + LTV caps based on credit score
 *   - monthly settlement (mortgages, maintenance, absentee rent collection)
 *
 * All money is integer cents. No Math.random().
 */

import type {
  Cents,
  GameState,
  Id,
  LedgerEntry,
  Loan,
  MacroState,
  Market,
  Property,
  PropertyClass,
  Tick,
} from "@/types/game";

import { dollars } from "@/lib/money";
import type { RNG } from "@/lib/rng";

import { adjustCreditScore, ledger, monthlyPayment, payLoanMonth } from "./finance";
import { ECONOMY } from "./constants";

// ---------- Constants ----------

/** Base sticker price per sqft for a class-B property in a neutral market (cents). */
const BASE_PRICE_PER_SQFT_CENTS = 32_000; // $320/sqft

/** Class multipliers on per-sqft price. */
const CLASS_MULTIPLIER: Record<PropertyClass, number> = {
  C: 0.65,
  B: 1.0,
  A: 1.55,
  trophy: 2.4,
};

/** Monthly maintenance as a fraction of appraised value. */
const MONTHLY_MAINTENANCE_FRACTION = 0.0018; // ~2.2% annual

/** List-rent as a fraction of appraised value per month (cap rate-ish). */
const MONTHLY_RENT_FRACTION = 0.0062; // ~7.4% annual gross yield

/** Realistic mortgage term. */
export const STANDARD_TERM_MONTHS = 360; // 30-yr

/** Loan-to-value cap by credit score band. */
export function maxLoanToValue(creditScore: number): number {
  if (creditScore >= 740) return 0.9;
  if (creditScore >= 700) return 0.85;
  if (creditScore >= 660) return 0.8;
  if (creditScore >= 620) return 0.7;
  if (creditScore >= 580) return 0.6;
  return 0; // denied
}

/** Rate spread over the macro risk-free rate based on credit. */
export function creditSpread(creditScore: number): number {
  if (creditScore >= 760) return 0.005;
  if (creditScore >= 720) return 0.012;
  if (creditScore >= 680) return 0.022;
  if (creditScore >= 640) return 0.035;
  if (creditScore >= 600) return 0.055;
  return 0.09; // punitive
}

/** Final mortgage rate = macro rate + credit spread. */
export function mortgageRate(macro: MacroState, creditScore: number): number {
  return macro.interestRate + creditSpread(creditScore);
}

// ---------- Valuation ----------

/**
 * Theoretical appraised value: base × class × sqft × market desirability × macro.
 */
export function appraiseProperty(
  property: Pick<Property, "class" | "sqft">,
  market: Market,
  macro: MacroState,
): Cents {
  const perSqft =
    BASE_PRICE_PER_SQFT_CENTS *
    CLASS_MULTIPLIER[property.class] *
    (0.55 + market.desirability * 0.9) *
    macro.realEstateMultiplier;
  return Math.round(perSqft * property.sqft);
}

/**
 * Compute monthly appreciation drift for a property. Biased by macro phase and
 * market desirability. Returns a delta in cents (can be negative).
 */
export function monthlyAppreciationDelta(
  property: Property,
  market: Market,
  macro: MacroState,
  rng: RNG,
): Cents {
  // Base trend: 0.18% monthly expected (~2.2%/yr), adjusted by macro and desirability.
  const phaseBias =
    macro.phase === "expansion" || macro.phase === "peak"
      ? 0.0012
      : macro.phase === "contraction" || macro.phase === "trough"
        ? -0.0015
        : 0.0005;
  const desirabilityBias = (market.desirability - 0.5) * 0.001;
  const classPremium =
    property.class === "trophy"
      ? 0.0008
      : property.class === "A"
        ? 0.0004
        : property.class === "C"
          ? -0.0003
          : 0;
  const noise = rng.nextFloat(-0.008, 0.008); // ±0.8% monthly vol
  const pct = 0.0018 + phaseBias + desirabilityBias + classPremium + noise;
  return Math.round(property.valueCents * pct);
}

// ---------- Loan origination ----------

export interface OriginateMortgageResult {
  ok: boolean;
  error?: string;
  loan?: Loan;
  downPayment?: Cents;
  monthlyPayment?: Cents;
}

/**
 * Attempt to originate a mortgage for a given purchase price and down payment.
 * Returns the loan, or an error if terms are not available.
 */
export function originateMortgage(params: {
  id: Id;
  propertyId: Id;
  purchasePriceCents: Cents;
  downPaymentCents: Cents;
  creditScore: number;
  macro: MacroState;
  tick: Tick;
}): OriginateMortgageResult {
  const {
    purchasePriceCents,
    downPaymentCents,
    creditScore,
    macro,
    tick,
    id,
    propertyId,
  } = params;

  if (purchasePriceCents <= 0) {
    return { ok: false, error: "Purchase price must be positive." };
  }
  if (downPaymentCents < 0 || downPaymentCents > purchasePriceCents) {
    return { ok: false, error: "Down payment out of bounds." };
  }

  const ltv = (purchasePriceCents - downPaymentCents) / purchasePriceCents;
  const maxLtv = maxLoanToValue(creditScore);
  if (maxLtv <= 0) {
    return {
      ok: false,
      error: `Credit score ${creditScore} below minimum for a mortgage (580).`,
    };
  }
  if (ltv > maxLtv) {
    const minDown = Math.ceil(purchasePriceCents * (1 - maxLtv));
    return {
      ok: false,
      error: `At credit ${creditScore}, max LTV is ${Math.round(maxLtv * 100)}%. Minimum down payment: $${Math.round(minDown / 100).toLocaleString()}.`,
    };
  }

  const principal = purchasePriceCents - downPaymentCents;
  if (principal === 0) {
    // All cash — no loan needed, but return a zero-balance sentinel.
    return {
      ok: true,
      loan: {
        id,
        kind: "mortgage",
        principal: 0,
        balance: 0,
        annualRate: 0,
        termMonths: STANDARD_TERM_MONTHS,
        monthlyPayment: 0,
        takenAtTick: tick,
        propertyId,
        downPaymentCents,
        missedPaymentsThisYear: 0,
      },
      downPayment: downPaymentCents,
      monthlyPayment: 0,
    };
  }

  const rate = mortgageRate(macro, creditScore);
  const pmt = monthlyPayment(principal, rate, STANDARD_TERM_MONTHS);

  return {
    ok: true,
    loan: {
      id,
      kind: "mortgage",
      principal,
      balance: principal,
      annualRate: rate,
      termMonths: STANDARD_TERM_MONTHS,
      monthlyPayment: pmt,
      takenAtTick: tick,
      propertyId,
      downPaymentCents,
      missedPaymentsThisYear: 0,
    },
    downPayment: downPaymentCents,
    monthlyPayment: pmt,
  };
}

/**
 * Refinance an existing mortgage at the current macro rate + current credit spread.
 * Returns the new loan (balance carries over), or an error.
 */
export function refinanceMortgage(
  existing: Loan,
  creditScore: number,
  macro: MacroState,
  tick: Tick,
  newId: Id,
): OriginateMortgageResult {
  if (existing.balance <= 0) {
    return { ok: false, error: "Loan already paid off." };
  }
  if (maxLoanToValue(creditScore) <= 0) {
    return {
      ok: false,
      error: `Credit score ${creditScore} below minimum to refinance.`,
    };
  }
  const rate = mortgageRate(macro, creditScore);
  const pmt = monthlyPayment(existing.balance, rate, STANDARD_TERM_MONTHS);
  // If new payment isn't better, block.
  if (pmt >= existing.monthlyPayment) {
    return {
      ok: false,
      error: `New rate ${(rate * 100).toFixed(2)}% wouldn't lower your payment.`,
    };
  }
  return {
    ok: true,
    loan: {
      ...existing,
      id: newId,
      kind: "mortgage",
      annualRate: rate,
      termMonths: STANDARD_TERM_MONTHS,
      monthlyPayment: pmt,
      takenAtTick: tick,
      missedPaymentsThisYear: 0,
    },
    monthlyPayment: pmt,
  };
}

// ---------- Seed-time generation ----------

const CLASS_WEIGHTS_BY_DESIRABILITY: readonly {
  min: number;
  weights: readonly [number, number, number, number];
}[] = [
  { min: 0.0, weights: [0.55, 0.35, 0.09, 0.01] }, // low-desirability: mostly C/B
  { min: 0.4, weights: [0.3, 0.5, 0.18, 0.02] },
  { min: 0.65, weights: [0.15, 0.45, 0.32, 0.08] },
  { min: 0.85, weights: [0.05, 0.3, 0.45, 0.2] }, // trophy-heavy
];

const STREETS = [
  "Harbor",
  "Maple",
  "Birch",
  "Industry",
  "Mercantile",
  "Commerce",
  "Fulton",
  "Pine",
  "Sycamore",
  "Bedford",
  "Olive",
  "Sunset",
  "Bay",
  "Oak",
];

function randomAddress(rng: RNG): string {
  const number = rng.nextInt(12, 1890);
  const street = rng.pick(STREETS);
  const suffix = rng.pick(["St", "Ave", "Ln", "Blvd", "Way"]);
  return `${number} ${street} ${suffix}`;
}

function pickClass(rng: RNG, desirability: number): PropertyClass {
  const classes: readonly PropertyClass[] = ["C", "B", "A", "trophy"];
  // pick the highest-min band the market satisfies
  let band = CLASS_WEIGHTS_BY_DESIRABILITY[0]!;
  for (const b of CLASS_WEIGHTS_BY_DESIRABILITY) {
    if (desirability >= b.min) band = b;
  }
  return rng.pickWeighted(classes, band.weights);
}

/**
 * Generate ~5-8 seed properties for a market at new-game time.
 * A mix of for-sale and rent-only listings.
 */
export function generatePropertiesForMarket(
  market: Market,
  macro: MacroState,
  rng: RNG,
  makeId: () => Id,
): Property[] {
  const n = rng.nextInt(5, 8);
  const out: Property[] = [];
  for (let i = 0; i < n; i++) {
    const cls = pickClass(rng.child(`cls-${i}`), market.desirability);
    const sqft = rng.nextInt(
      cls === "C" ? 900 : cls === "B" ? 1400 : cls === "A" ? 2200 : 3500,
      cls === "C" ? 1800 : cls === "B" ? 2600 : cls === "A" ? 4500 : 7500,
    );
    const appraised = appraiseProperty({ class: cls, sqft }, market, macro);
    const listedForSale = rng.chance(0.65);
    const listedForRent = rng.chance(0.9);
    const maintenance = Math.round(appraised * MONTHLY_MAINTENANCE_FRACTION);
    const rentAsk = Math.round(appraised * MONTHLY_RENT_FRACTION);

    const p: Property = {
      id: makeId(),
      marketId: market.id,
      address: randomAddress(rng.child(`addr-${i}`)),
      class: cls,
      sqft,
      valueCents: appraised,
      purchasePriceCents: 0,
      maintenanceMonthlyCents: maintenance,
      listPriceCents: listedForSale
        ? Math.round(appraised * rng.nextFloat(0.96, 1.08))
        : undefined,
      listRentCents: listedForRent ? rentAsk : undefined,
    };
    out.push(p);
  }
  return out;
}

// ---------- Monthly settlement ----------

export interface MonthlySettlementResult {
  state: GameState;
  ledger: LedgerEntry[];
}

/**
 * Run the monthly settlement pass. Mutates nothing — returns new state.
 *
 *  For each mortgage: attempt to pay from the responsible cash pool.
 *  For each player-owned property: pay maintenance; collect rent if leased.
 *  Then: revalue every property (macro + noise).
 */
export function runMonthlySettlement(
  state: GameState,
  tick: Tick,
  rng: RNG,
): MonthlySettlementResult {
  const out: LedgerEntry[] = [];
  const mortgages = { ...state.mortgages };
  const properties = { ...state.properties };
  const businesses = { ...state.businesses };
  let player = state.player;
  let rivals = state.rivals;

  // 1. Mortgage payments.
  for (const loanId of Object.keys(mortgages)) {
    const loan = mortgages[loanId]!;
    if (loan.balance <= 0) continue;
    const prop = loan.propertyId ? properties[loan.propertyId] : undefined;
    if (!prop || !prop.ownerId) continue;

    // Who pays? Player if player owns, rival if rival owns.
    if (prop.ownerId === player.id) {
      if (player.personalCash >= loan.monthlyPayment) {
        const { loan: updated, interest, principalPaid } = payLoanMonth(loan, tick);
        mortgages[loanId] = updated;
        player = {
          ...player,
          personalCash: player.personalCash - loan.monthlyPayment,
          creditScore: adjustCreditScore(player.creditScore, +1),
        };
        out.push(
          ledger(
            `mort-int-${loanId}-${tick}`,
            tick,
            -interest,
            "mortgage_interest",
            `Interest: ${prop.address}`,
          ),
        );
        out.push(
          ledger(
            `mort-pri-${loanId}-${tick}`,
            tick,
            -principalPaid,
            "mortgage_principal",
            `Principal: ${prop.address}`,
          ),
        );
      } else {
        // Missed payment — serious credit ding + counter bump.
        mortgages[loanId] = {
          ...loan,
          missedPaymentsThisYear: (loan.missedPaymentsThisYear ?? 0) + 1,
        };
        player = {
          ...player,
          creditScore: adjustCreditScore(player.creditScore, -35),
        };
        out.push(
          ledger(
            `mort-missed-${loanId}-${tick}`,
            tick,
            0,
            "other",
            `Missed mortgage: ${prop.address} (-35 credit)`,
          ),
        );
      }
    } else {
      // Rival-owned: assume they pay out of net worth (abstracted).
      const rival = rivals[prop.ownerId];
      if (rival && rival.netWorth >= loan.monthlyPayment) {
        const { loan: updated } = payLoanMonth(loan, tick);
        mortgages[loanId] = updated;
        rivals = {
          ...rivals,
          [rival.id]: {
            ...rival,
            netWorth: rival.netWorth - loan.monthlyPayment,
          },
        };
      }
    }
  }

  // 2. Property maintenance + rent collection.
  for (const propId of Object.keys(properties)) {
    const prop = properties[propId]!;
    if (!prop.ownerId) continue; // absentee landlord: simulated elsewhere

    // Maintenance charge.
    if (prop.ownerId === player.id) {
      if (player.personalCash >= prop.maintenanceMonthlyCents) {
        player = {
          ...player,
          personalCash: player.personalCash - prop.maintenanceMonthlyCents,
        };
        out.push(
          ledger(
            `maint-${propId}-${tick}`,
            tick,
            -prop.maintenanceMonthlyCents,
            "property_maintenance",
            `Maintenance: ${prop.address}`,
          ),
        );
      }
    }

    // Rent collection if a tenant business sits here AND owner != business owner.
    const hosted = prop.hostedBusinessId
      ? businesses[prop.hostedBusinessId]
      : undefined;
    if (
      hosted &&
      hosted.ownerId !== prop.ownerId &&
      prop.listRentCents &&
      prop.ownerId === player.id
    ) {
      // Player collects rent from someone else. Simplification: the tenant's
      // rent is already charged on their weekly/monthly biz side; we just
      // credit the player here.
      player = {
        ...player,
        personalCash: player.personalCash + prop.listRentCents,
      };
      out.push(
        ledger(
          `rent-in-${propId}-${tick}`,
          tick,
          +prop.listRentCents,
          "rent_income",
          `Rent collected: ${prop.address}`,
        ),
      );
    }
  }

  // 3. Revaluation pass.
  for (const propId of Object.keys(properties)) {
    const prop = properties[propId]!;
    const market = state.markets[prop.marketId];
    if (!market) continue;
    const delta = monthlyAppreciationDelta(
      prop,
      market,
      state.macro,
      rng.child(`val-${propId}`),
    );
    properties[propId] = {
      ...prop,
      valueCents: Math.max(1000_00, prop.valueCents + delta), // floor at $1k
    };
  }

  return {
    state: {
      ...state,
      player,
      rivals,
      properties,
      mortgages,
      businesses,
    },
    ledger: out,
  };
}

// ---------- Player equity helpers ----------

/** Net equity in all properties the player owns. */
export function playerRealEstateEquity(state: GameState): Cents {
  let equity = 0;
  for (const prop of Object.values(state.properties)) {
    if (prop.ownerId !== state.player.id) continue;
    const mortBal = prop.mortgageId
      ? (state.mortgages[prop.mortgageId]?.balance ?? 0)
      : 0;
    equity += prop.valueCents - mortBal;
  }
  return equity;
}

/** Total outstanding mortgage balance for the player. */
export function playerMortgageDebt(state: GameState): Cents {
  let total = 0;
  for (const prop of Object.values(state.properties)) {
    if (prop.ownerId !== state.player.id) continue;
    if (!prop.mortgageId) continue;
    total += state.mortgages[prop.mortgageId]?.balance ?? 0;
  }
  return total;
}

/** Debug label for a property (used in UI and logs). */
export function propertyLabel(p: Property): string {
  return `${p.address} · ${p.class}-class · ${p.sqft.toLocaleString()} sqft`;
}

/** Display-facing credit band for a given score. */
export interface CreditBand {
  label: "Excellent" | "Good" | "Fair" | "Poor" | "Subprime";
  color: "emerald" | "lime" | "amber" | "orange" | "red";
  minLtv: number;
  spreadPct: number;
}

export function creditBand(score: number): CreditBand {
  const minLtv = maxLoanToValue(score);
  const spreadPct = creditSpread(score) * 100;
  if (score >= 760) return { label: "Excellent", color: "emerald", minLtv, spreadPct };
  if (score >= 700) return { label: "Good", color: "lime", minLtv, spreadPct };
  if (score >= 640) return { label: "Fair", color: "amber", minLtv, spreadPct };
  if (score >= 580) return { label: "Poor", color: "orange", minLtv, spreadPct };
  return { label: "Subprime", color: "red", minLtv, spreadPct };
}

/**
 * Yearly reset — zero out the per-mortgage `missedPaymentsThisYear` counter.
 * Call from the tick loop on the year boundary.
 */
export function resetYearlyMissedPayments(state: GameState): GameState {
  const mortgages: typeof state.mortgages = {};
  for (const id of Object.keys(state.mortgages)) {
    mortgages[id] = {
      ...state.mortgages[id]!,
      missedPaymentsThisYear: 0,
    };
  }
  return { ...state, mortgages };
}

// Keep the ECONOMY import alive for future reference to constants.
void ECONOMY;
void dollars;
