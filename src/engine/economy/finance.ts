/**
 * Finance primitives: loans, amortization, taxes.
 *
 * All money is integer cents.
 */

import type { Cents, LedgerEntry, Loan, Tick } from "@/types/game";

import { ECONOMY } from "./constants";

/** Monthly payment for a fully-amortized loan. */
export function monthlyPayment(
  principal: Cents,
  annualRate: number,
  termMonths: number,
): Cents {
  if (annualRate === 0) return Math.round(principal / termMonths);
  const r = annualRate / 12;
  const denom = 1 - Math.pow(1 + r, -termMonths);
  return Math.round((principal * r) / denom);
}

/**
 * Apply one month of payment to a loan. Returns an updated Loan, ledger
 * entry for the payment (split into interest + principal if you want to
 * log both), and whether the loan is now paid off.
 */
export function payLoanMonth(
  loan: Loan,
  tick: Tick,
): { loan: Loan; interest: Cents; principalPaid: Cents; paidOff: boolean } {
  const r = loan.annualRate / 12;
  const interest = Math.round(loan.balance * r);
  let principalPaid = loan.monthlyPayment - interest;
  if (principalPaid > loan.balance) principalPaid = loan.balance;
  const newBalance = loan.balance - principalPaid;
  const paidOff = newBalance <= 0;

  const updated: Loan = {
    ...loan,
    balance: Math.max(0, newBalance),
  };
  return { loan: updated, interest, principalPaid, paidOff };
}

/**
 * Progressive income tax (one jurisdiction for MVP). Returns tax owed.
 */
export function incomeTax(incomeCents: Cents): Cents {
  let remaining = Math.max(0, incomeCents);
  let owed = 0;
  let lastCap = 0;
  for (const bracket of ECONOMY.INCOME_TAX_BRACKETS) {
    const span = bracket.upToCents - lastCap;
    const taxable = Math.min(remaining, span);
    if (taxable <= 0) break;
    owed += Math.round(taxable * bracket.rate);
    remaining -= taxable;
    lastCap = bracket.upToCents;
    if (remaining <= 0) break;
  }
  return owed;
}

export function corporateTax(profitCents: Cents): Cents {
  if (profitCents <= 0) return 0;
  return Math.round(profitCents * ECONOMY.CORP_TAX_FLAT_RATE);
}

/**
 * Credit score nudger. Keeps score in [300, 850].
 */
export function adjustCreditScore(
  current: number,
  delta: number,
): number {
  return Math.max(300, Math.min(850, current + delta));
}

/** Convenience: build a ledger entry. */
export function ledger(
  id: string,
  tick: Tick,
  amount: Cents,
  category: LedgerEntry["category"],
  memo: string,
  businessId?: string,
): LedgerEntry {
  return { id, tick, amount, category, memo, businessId };
}
