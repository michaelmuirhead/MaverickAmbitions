/**
 * Personal bankruptcy (v0.9 Failure & Flow).
 *
 * The last domino in the failure cascade: when a player's business-loan
 * balances collapse into personal unsecured debt (via liquidation) and
 * their liquidatable assets can no longer service even 25% of the
 * outstanding balance, they file Chapter 7.
 *
 * Trigger formula (evaluated at each weekly tick after liquidations):
 *
 *     cash + liquid + 0.5 * realEstateEquity < personalUnsecuredDebt * 0.25
 *
 * `liquid` is 0 in v0.9 — a placeholder for future brokerage/investment
 * accounts. The 0.5 multiplier on real-estate equity reflects that
 * illiquid real estate can't be quickly turned into cash without taking
 * a haircut; courts and lenders apply a similar discount when deciding
 * solvency.
 *
 * Filing side-effects (all atomic, all in one tick):
 *
 *   1. Every player-owned property is foreclosed at 90% of market value.
 *      The secured mortgage is paid off first; any surplus reduces
 *      outstanding unsecured debt. Properties return to the absentee
 *      landlord pool and are re-listed at full market value.
 *
 *   2. Any remaining personal unsecured debt is discharged (written off
 *      the player's balance sheet, booked as a positive `debt_discharge`
 *      ledger entry). Personal loans are wiped out simultaneously — in
 *      Chapter 7 they have the same unsecured-creditor status and get
 *      the same treatment.
 *
 *   3. Credit score drops to 300, the floor.
 *
 *   4. `bankruptcyFlag` is set with a 7-year lockout expiry. While
 *      active, downstream systems tighten terms (halve commercial-lease
 *      finance-band caps, deny new business loans, etc. — those enforce
 *      in v0.10+).
 *
 *   5. A history entry is pushed to `bankruptcyHistory` for dynasty
 *      tracking.
 *
 *   6. `player.alive = false` so the end-of-tick succession flow kicks
 *      in. If an eligible heir (child age ≥ 18) exists, they inherit
 *      surviving businesses with a clean personal balance sheet. If
 *      not, the game enters a terminal state the UI renders as
 *      game-over.
 */

import type {
  Cents,
  GameEvent,
  GameState,
  Id,
  LedgerEntry,
  Property,
  Tick,
} from "@/types/game";

import { HOURS_PER_YEAR } from "@/lib/date";
import { formatMoney } from "@/lib/money";

/** 7 in-game years (each 24 × 365 = 8,760 hours). */
export const BANKRUPTCY_LOCKOUT_TICKS = HOURS_PER_YEAR * 7;

/** Forced-sale recovery rate for real estate in personal bankruptcy. */
export const REAL_ESTATE_FORECLOSURE_RATE = 0.9;

/**
 * Discount applied to real-estate equity when computing whether the
 * player can still service their debt. Reflects illiquidity.
 */
export const REAL_ESTATE_LIQUIDITY_DISCOUNT = 0.5;

/**
 * Fraction of outstanding unsecured debt used as the solvency threshold.
 * If the player can't muster at least this from liquid + discounted
 * illiquid assets, they file.
 */
export const INSOLVENCY_DEBT_SERVICE_RATIO = 0.25;

/**
 * Can the player currently file? Two guards:
 *   - Must have unsecured debt to discharge in the first place.
 *   - Must not already be in an active 7-year lockout.
 */
export function shouldFilePersonalBankruptcy(state: GameState): boolean {
  const p = state.player;
  if (p.personalUnsecuredDebtCents <= 0) return false;
  if (p.bankruptcyFlag) return false; // already in the lockout window
  if (!p.alive) return false; // dead players don't file

  const cash = p.personalCash;
  const liquid = 0; // placeholder; investments system adds to this later
  const reEquity = computeRealEstateEquity(state);
  const available =
    cash + liquid + Math.floor(REAL_ESTATE_LIQUIDITY_DISCOUNT * reEquity);
  const threshold = Math.floor(
    p.personalUnsecuredDebtCents * INSOLVENCY_DEBT_SERVICE_RATIO,
  );

  return available < threshold;
}

/**
 * Execute a Chapter-7 filing. Returns a fully updated state snapshot
 * plus a summary of what happened. Caller (engine tick) replaces its
 * working state with the returned snapshot.
 */
export function filePersonalBankruptcy(
  state: GameState,
  tick: Tick,
): {
  state: GameState;
  event: GameEvent;
  netWorthAtFilingCents: Cents;
  foreclosedPropertyIds: Id[];
} {
  const netWorthAtFilingCents = computeNetWorth(state);

  // --- 1. Foreclose every player-owned property ---
  const ledgerAdded: LedgerEntry[] = [];
  const foreclosedPropertyIds: Id[] = [];
  const nextProperties: Record<Id, Property> = { ...state.properties };
  const nextMortgages = { ...state.mortgages };
  let surplusToApplyAgainstUnsecured = 0;

  for (const [propId, prop] of Object.entries(state.properties)) {
    if (prop.ownerId !== state.player.id) continue;
    foreclosedPropertyIds.push(propId);

    const saleProceeds = Math.floor(
      prop.valueCents * REAL_ESTATE_FORECLOSURE_RATE,
    );
    const writeoff = prop.valueCents - saleProceeds;
    const mortBal = prop.mortgageId
      ? (state.mortgages[prop.mortgageId]?.balance ?? 0)
      : 0;

    // Mortgage gets paid first from the sale proceeds. Anything left
    // goes against the player's unsecured stack; if the mortgage
    // exceeds proceeds the deficiency is absorbed in the discharge
    // (junior lien wipeout is standard in Chapter 7).
    const afterMortgage = saleProceeds - mortBal;
    if (afterMortgage > 0) {
      surplusToApplyAgainstUnsecured += afterMortgage;
    }

    ledgerAdded.push(
      {
        id: `bk-fcl-proc-${propId}-${tick}`,
        tick,
        amount: saleProceeds,
        category: "foreclosure_proceeds",
        memo: `Foreclosure sale: ${prop.address} @ ${Math.round(REAL_ESTATE_FORECLOSURE_RATE * 100)}% of market`,
      },
      {
        id: `bk-fcl-wo-${propId}-${tick}`,
        tick,
        amount: -writeoff,
        category: "foreclosure_writeoff",
        memo: `Foreclosure writeoff: ${prop.address}`,
      },
    );

    // Wipe the mortgage record and return the property to the absentee
    // pool. Hosted-business links on this property will have already
    // been broken during the liquidation pass that put the player here.
    if (prop.mortgageId) {
      delete nextMortgages[prop.mortgageId];
    }
    nextProperties[propId] = {
      ...prop,
      ownerId: undefined,
      mortgageId: undefined,
      purchasePriceCents: 0,
      purchaseTick: undefined,
      listPriceCents: prop.valueCents,
      hostedBusinessId: undefined,
    };
  }

  // --- 2. Unsecured discharge ---
  const startingUnsecured = state.player.personalUnsecuredDebtCents;
  const unsecuredAfterSurplus = Math.max(
    0,
    startingUnsecured - surplusToApplyAgainstUnsecured,
  );
  const surplusRemaining = Math.max(
    0,
    surplusToApplyAgainstUnsecured - startingUnsecured,
  );
  if (unsecuredAfterSurplus > 0) {
    ledgerAdded.push({
      id: `bk-discharge-${tick}`,
      tick,
      amount: unsecuredAfterSurplus,
      category: "debt_discharge",
      memo: `Chapter 7 discharge: ${formatMoney(unsecuredAfterSurplus)} unsecured debt`,
    });
  }

  // Personal loans get discharged too (same unsecured-creditor class).
  const dischargedPersonalLoans = state.player.personalLoans.reduce(
    (sum, l) => sum + l.balance,
    0,
  );
  if (dischargedPersonalLoans > 0) {
    ledgerAdded.push({
      id: `bk-loans-${tick}`,
      tick,
      amount: dischargedPersonalLoans,
      category: "debt_discharge",
      memo: `Chapter 7 discharge: ${formatMoney(dischargedPersonalLoans)} in personal loans`,
    });
  }

  // --- 3. Announcement event ---
  const totalDischarged = unsecuredAfterSurplus + dischargedPersonalLoans;
  const event: GameEvent = {
    id: `bk-${tick}`,
    tick,
    kind: "personal_event",
    title: "Personal bankruptcy filed",
    detail: buildFilingDetail({
      foreclosedCount: foreclosedPropertyIds.length,
      totalDischarged,
      prevCredit: state.player.creditScore,
      netWorthAtFilingCents,
    }),
    dismissed: false,
    blocking: true,
  };

  // --- 4. Player state update ---
  const expiresAtTick = tick + BANKRUPTCY_LOCKOUT_TICKS;
  const nextPlayer = {
    ...state.player,
    personalCash: surplusRemaining, // nearly always 0
    personalUnsecuredDebtCents: 0,
    personalLoans: [],
    creditScore: 300,
    bankruptcyFlag: { filedAtTick: tick, expiresAtTick },
    bankruptcyHistory: [
      ...state.player.bankruptcyHistory,
      { tick, netWorthAtFilingCents },
    ],
    // Setting alive=false triggers the existing end-of-tick succession
    // flow: `applySuccession` picks the eldest eligible heir, promotes
    // them, and transfers surviving business ownership. If no heir, the
    // game enters its terminal state (player stays dead, UI will render
    // game-over on the next render cycle).
    alive: false,
    deathTick: tick,
  };

  const nextState: GameState = {
    ...state,
    properties: nextProperties,
    mortgages: nextMortgages,
    player: nextPlayer,
    ledger: [...state.ledger, ...ledgerAdded],
    events: [...state.events, event],
  };

  return {
    state: nextState,
    event,
    netWorthAtFilingCents,
    foreclosedPropertyIds,
  };
}

// ---------- helpers ----------

function computeRealEstateEquity(state: GameState): Cents {
  let eq = 0;
  for (const prop of Object.values(state.properties)) {
    if (prop.ownerId !== state.player.id) continue;
    const mortBal = prop.mortgageId
      ? (state.mortgages[prop.mortgageId]?.balance ?? 0)
      : 0;
    eq += Math.max(0, prop.valueCents - mortBal);
  }
  return eq;
}

/**
 * Pre-filing net-worth snapshot, used for the bankruptcyHistory entry.
 * Mirrors `selectNetWorth` but lives here because the selectors module
 * is marked client-only.
 */
function computeNetWorth(state: GameState): Cents {
  const p = state.player;
  const bizCash = Object.values(state.businesses)
    .filter((b) => b.ownerId === p.id)
    .reduce((acc, b) => acc + b.cash, 0);
  const reEquity = computeRealEstateEquity(state);
  const bLoanDebt = Object.values(state.businessLoans ?? {})
    .filter((l) => {
      const biz = l.businessId ? state.businesses[l.businessId] : undefined;
      return biz?.ownerId === p.id;
    })
    .reduce((acc, l) => acc + l.balance, 0);
  const personalLoanDebt = p.personalLoans.reduce(
    (acc, l) => acc + l.balance,
    0,
  );
  return (
    p.personalCash +
    bizCash +
    reEquity -
    bLoanDebt -
    personalLoanDebt -
    p.personalUnsecuredDebtCents
  );
}

function buildFilingDetail(args: {
  foreclosedCount: number;
  totalDischarged: Cents;
  prevCredit: number;
  netWorthAtFilingCents: Cents;
}): string {
  const { foreclosedCount, totalDischarged, prevCredit, netWorthAtFilingCents } =
    args;
  const foreclosurePart =
    foreclosedCount === 0
      ? "No real estate to foreclose."
      : `${foreclosedCount} ${foreclosedCount === 1 ? "property" : "properties"} foreclosed.`;
  return (
    `Chapter 7 filed. ${foreclosurePart} ${formatMoney(totalDischarged)} in unsecured debt discharged. ` +
    `Credit ${prevCredit} → 300. 7-year lockout in effect on new business loans. ` +
    `Net worth at filing: ${formatMoney(netWorthAtFilingCents)}. ` +
    `Your heir (if any) will take over surviving businesses with a clean balance sheet.`
  );
}
