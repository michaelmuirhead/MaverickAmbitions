/**
 * Business-startup loans (v0.5.1 — "Small-business credit").
 *
 * Closes the original soft-lock: player starts with $15K, the cheapest
 * business (corner store) costs $35K. Before this module, there was no
 * bridging mechanic and the game was unbeginnable.
 *
 * Mechanically this mirrors the mortgage module:
 *   - credit-score-gated: <580 denied
 *   - loan-to-cost cap rises with credit score (see `maxLoanToCost`)
 *   - rate = macro risk-free + credit spread + SBA spread (see `businessLoanRate`)
 *   - standard 60-month term (5-yr SBA 7(a)-style)
 *   - monthly payments auto-draw from business cash (primary) with
 *     personal-cash fallback, mirroring real SBA personal-guarantee
 *     structure. Missed payments ding credit -35.
 *
 * Not included in this MVP: lump-sum paydown (let it amortize), refi,
 * collateralization against business assets, business-loan default /
 * liquidation. All tractable to add later — the state shape supports it.
 */

import type {
  Business,
  Cents,
  GameState,
  Id,
  LedgerEntry,
  Loan,
  MacroState,
  Tick,
} from "@/types/game";

import { adjustCreditScore, ledger, monthlyPayment, payLoanMonth } from "./finance";

// ---------- Terms ----------

/** Standard SBA 7(a)-ish term. */
export const BUSINESS_LOAN_TERM_MONTHS = 60;

/** Minimum credit score to originate. */
export const BUSINESS_LOAN_MIN_CREDIT = 580;

/**
 * SBA-style unsecured small-biz debt sits above mortgage rates.
 * Added on top of the macro risk-free rate + credit spread.
 */
export const BUSINESS_LOAN_SBA_SPREAD = 0.03;

/** Loan-to-cost cap by credit band. Unsecured → tighter than mortgages. */
export function maxLoanToCost(creditScore: number): number {
  if (creditScore >= 760) return 0.85;
  if (creditScore >= 720) return 0.8;
  if (creditScore >= 680) return 0.75;
  if (creditScore >= 640) return 0.7;
  if (creditScore >= BUSINESS_LOAN_MIN_CREDIT) return 0.6;
  return 0; // denied
}

/** Credit spread for unsecured small-biz debt. */
export function businessCreditSpread(creditScore: number): number {
  if (creditScore >= 760) return 0.01;
  if (creditScore >= 720) return 0.02;
  if (creditScore >= 680) return 0.035;
  if (creditScore >= 640) return 0.05;
  if (creditScore >= BUSINESS_LOAN_MIN_CREDIT) return 0.075;
  return 0.11; // punitive
}

/** Final business-loan APR = macro risk-free + credit spread + SBA spread. */
export function businessLoanRate(
  macro: MacroState,
  creditScore: number,
): number {
  return macro.interestRate + businessCreditSpread(creditScore) + BUSINESS_LOAN_SBA_SPREAD;
}

// ---------- Origination ----------

export interface OriginateBusinessLoanResult {
  ok: boolean;
  error?: string;
  loan?: Loan;
  monthlyPayment?: Cents;
  maxBorrowCents?: Cents;
}

/**
 * Attempt to originate a business startup loan.
 * `startupCostCents` is the full cost of the business being opened;
 * `borrowCents` is how much the player wants to finance (rest is cash).
 */
export function originateBusinessLoan(params: {
  id: Id;
  businessId: Id;
  startupCostCents: Cents;
  borrowCents: Cents;
  creditScore: number;
  macro: MacroState;
  tick: Tick;
}): OriginateBusinessLoanResult {
  const {
    id,
    businessId,
    startupCostCents,
    borrowCents,
    creditScore,
    macro,
    tick,
  } = params;

  if (startupCostCents <= 0) {
    return { ok: false, error: "Startup cost must be positive." };
  }
  if (borrowCents <= 0) {
    return { ok: false, error: "Borrow amount must be positive." };
  }
  if (borrowCents > startupCostCents) {
    return { ok: false, error: "Cannot borrow more than the startup cost." };
  }

  const maxLtc = maxLoanToCost(creditScore);
  if (maxLtc <= 0) {
    return {
      ok: false,
      error: `Credit score ${creditScore} below minimum (${BUSINESS_LOAN_MIN_CREDIT}) for a business loan.`,
      maxBorrowCents: 0,
    };
  }

  const maxBorrow = Math.floor(startupCostCents * maxLtc);
  if (borrowCents > maxBorrow) {
    return {
      ok: false,
      error: `At credit ${creditScore}, max loan-to-cost is ${Math.round(maxLtc * 100)}% ($${Math.round(maxBorrow / 100).toLocaleString()} of $${Math.round(startupCostCents / 100).toLocaleString()}).`,
      maxBorrowCents: maxBorrow,
    };
  }

  const rate = businessLoanRate(macro, creditScore);
  const pmt = monthlyPayment(borrowCents, rate, BUSINESS_LOAN_TERM_MONTHS);

  return {
    ok: true,
    loan: {
      id,
      kind: "business",
      principal: borrowCents,
      balance: borrowCents,
      annualRate: rate,
      termMonths: BUSINESS_LOAN_TERM_MONTHS,
      monthlyPayment: pmt,
      takenAtTick: tick,
      businessId,
      missedPaymentsThisYear: 0,
    },
    monthlyPayment: pmt,
    maxBorrowCents: maxBorrow,
  };
}

// ---------- Monthly settlement ----------

export interface BusinessLoanSettlementResult {
  businessLoans: Record<Id, Loan>;
  businesses: Record<Id, Business>;
  player: GameState["player"];
  ledger: LedgerEntry[];
}

/**
 * Apply one month of payments across all outstanding business loans.
 * Payment draws from the financed business's cash first; if the business
 * cash is short (or the business no longer exists), fallback to personal
 * cash. Missing both → credit ding, balance untouched (it'll be retried
 * next month).
 *
 * This function is pure: pass in state, get new state fragments back.
 * Caller splices the results into the world.
 */
export function runMonthlyBusinessLoanPayments(
  state: GameState,
  tick: Tick,
): BusinessLoanSettlementResult {
  const out: LedgerEntry[] = [];
  const loans = { ...state.businessLoans };
  const businesses = { ...state.businesses };
  let player = state.player;

  for (const loanId of Object.keys(loans)) {
    const loan = loans[loanId]!;
    if (loan.balance <= 0) continue;
    const bizId = loan.businessId;
    const biz = bizId ? businesses[bizId] : undefined;
    const payment = loan.monthlyPayment;

    // Only player-owned business loans run through this path. Rivals get
    // an abstracted credit line in strategy.ts.
    const isPlayerLoan = !biz || biz.ownerId === player.id;
    if (!isPlayerLoan) continue;

    const bizCash = biz ? biz.cash : 0;
    let paidFromBiz = 0;
    let paidFromPersonal = 0;

    if (bizCash >= payment) {
      paidFromBiz = payment;
    } else if (bizCash + player.personalCash >= payment) {
      paidFromBiz = bizCash;
      paidFromPersonal = payment - bizCash;
    } else {
      // Missed payment — credit ding, balance sits untouched.
      loans[loanId] = {
        ...loan,
        missedPaymentsThisYear: (loan.missedPaymentsThisYear ?? 0) + 1,
      };
      player = {
        ...player,
        creditScore: adjustCreditScore(player.creditScore, -35),
      };
      out.push(
        ledger(
          `bloan-missed-${loanId}-${tick}`,
          tick,
          0,
          "other",
          `Missed business loan payment (-35 credit)`,
          bizId,
        ),
      );
      continue;
    }

    const { loan: updated, interest, principalPaid } = payLoanMonth(loan, tick);
    loans[loanId] = updated;

    if (biz && paidFromBiz > 0) {
      businesses[biz.id] = { ...biz, cash: biz.cash - paidFromBiz };
    }
    if (paidFromPersonal > 0) {
      player = {
        ...player,
        personalCash: player.personalCash - paidFromPersonal,
      };
    }
    // On-time payment is a small credit nudge. Matches the mortgage path.
    player = {
      ...player,
      creditScore: adjustCreditScore(player.creditScore, +1),
    };

    out.push(
      ledger(
        `bloan-int-${loanId}-${tick}`,
        tick,
        -interest,
        "business_loan_interest",
        `Interest: business loan`,
        bizId,
      ),
    );
    out.push(
      ledger(
        `bloan-pri-${loanId}-${tick}`,
        tick,
        -principalPaid,
        "business_loan_principal",
        `Principal: business loan`,
        bizId,
      ),
    );
  }

  return {
    businessLoans: loans,
    businesses,
    player,
    ledger: out,
  };
}

/** Sum of all outstanding business-loan balances for a given owner. */
export function playerBusinessLoanDebt(state: GameState): Cents {
  let total = 0;
  for (const loan of Object.values(state.businessLoans)) {
    if (loan.balance <= 0) continue;
    // Either biz is player-owned, or the biz was closed (liability survives).
    const biz = loan.businessId ? state.businesses[loan.businessId] : undefined;
    if (biz && biz.ownerId !== state.player.id) continue;
    total += loan.balance;
  }
  return total;
}
