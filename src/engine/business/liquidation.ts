/**
 * Business closure — liquidation (forced) + voluntary close.
 *
 * v0.9 Failure & Flow. Invoked from two places:
 *
 *   1. Engine tick — when the insolvency state machine marks a business
 *      `insolvent` (4 consecutive distressed weeks), the tick calls
 *      `liquidateBusiness` to convert it into a closed record. Assets
 *      recover at 40% of book, credit drops 80 points, any outstanding
 *      business loan collapses to `player.personalUnsecuredDebtCents`.
 *
 *   2. Store action (UI) — the player can pre-empt forced liquidation
 *      by closing voluntarily. Assets recover at 60% of book (better),
 *      credit drops 40 points (better), any outstanding business loan
 *      still collapses to personal unsecured debt (same treatment).
 *
 * Both paths:
 *   - remove the Business record from `state.businesses`
 *   - remove the biz id from `market.businessIds`
 *   - clear `property.hostedBusinessId` if hosted on an owned property
 *     (player retains the real-estate asset — it's separate from the
 *     business entity)
 *   - delete any `businessLoans` whose `businessId` matches (their
 *     balance has been rolled into personal unsecured debt)
 *   - append a `ClosedBusinessRecord` postmortem to
 *     `player.closedBusinesses` for the graveyard view (task #51)
 *   - emit a blocking game event so the player is forced to notice
 */

import type {
  Business,
  ClosedBusinessRecord,
  GameEvent,
  GameState,
  Id,
  LedgerEntry,
  Tick,
} from "@/types/game";

import { formatMoney } from "@/lib/money";

import { getBusinessModule } from "./registry";

/**
 * Fraction of `startupCostCents` (book value proxy) recovered when
 * liquidating versus closing voluntarily. Tuned so the difference is
 * material: 40% forced vs. 60% voluntary creates a real incentive for
 * the player to pull the plug before the 4-week buzzer.
 */
export const RECOVERY_RATE = {
  liquidation: 0.4,
  voluntary_close: 0.6,
} as const;

/** Credit-score delta on each closure path. Clamped to [300, 850]. */
export const CREDIT_IMPACT = {
  liquidation: -80,
  voluntary_close: -40,
} as const;

export type CloseReason = "liquidation" | "voluntary_close";

export interface CloseBusinessSuccess {
  ok: true;
  /** Fully-updated game state with the business removed and closure booked. */
  state: GameState;
  /** Postmortem record written to `player.closedBusinesses[bizId]`. */
  record: ClosedBusinessRecord;
  /** The closure-announcement game event, already appended to `state.events`. */
  event: GameEvent;
}

export interface CloseBusinessFailure {
  ok: false;
  error: string;
}

export type CloseBusinessResult = CloseBusinessSuccess | CloseBusinessFailure;

/**
 * Close a player-owned business — either forced (liquidation) or
 * voluntary. Returns a fully updated state snapshot; the caller replaces
 * its working state with `result.state` on success.
 *
 * Pure function — no RNG, no I/O. The ledger entries, event, and record
 * are all embedded in the returned `state`.
 */
export function closeBusiness(
  state: GameState,
  bizId: Id,
  reason: CloseReason,
  tick: Tick,
): CloseBusinessResult {
  const biz = state.businesses[bizId];
  if (!biz) return { ok: false, error: "Business not found." };
  if (biz.ownerId !== state.player.id) {
    return { ok: false, error: "Not your business to close." };
  }

  let mod;
  try {
    mod = getBusinessModule(biz.type);
  } catch {
    return {
      ok: false,
      error: `Business module for '${biz.type}' not registered.`,
    };
  }

  // --- Valuation ---
  const bookValueCents = mod.startup.startupCostCents;
  const recoveryRate = RECOVERY_RATE[reason];
  const grossProceeds = Math.floor(bookValueCents * recoveryRate);
  const writeoffCents = bookValueCents - grossProceeds;

  // Business cash: if positive (voluntary close case), it returns to the
  // player's wallet. If negative (typical insolvency), the shortfall is
  // already reflected as past losses in the ledger — no double-count.
  const bizCashToPersonal = Math.max(0, biz.cash);

  // Any outstanding business loan for this biz collapses to the player's
  // personal unsecured debt. We also have to delete those loan records so
  // the monthly settlement stops trying to bill the business for them.
  const attachedLoans = Object.values(state.businessLoans ?? {}).filter(
    (l) => l.businessId === bizId,
  );
  const outstandingLoanBalance = attachedLoans.reduce(
    (sum, l) => sum + l.balance,
    0,
  );

  // Credit score impact, clamped to [300, 850].
  const creditDelta = CREDIT_IMPACT[reason];
  const nextCredit = Math.max(
    300,
    Math.min(850, state.player.creditScore + creditDelta),
  );

  // --- Ledger entries ---
  const ledgerAdded: LedgerEntry[] = [
    {
      id: `close-proc-${bizId}-${tick}`,
      tick,
      amount: grossProceeds,
      category: "liquidation_proceeds",
      memo: `${reason === "liquidation" ? "Liquidation" : "Voluntary-close"} proceeds: ${biz.name} @ ${Math.round(recoveryRate * 100)}% of book`,
      businessId: bizId,
    },
    {
      id: `close-wo-${bizId}-${tick}`,
      tick,
      amount: -writeoffCents,
      category: "liquidation_writeoff",
      memo: `${reason === "liquidation" ? "Liquidation" : "Voluntary-close"} writeoff: ${biz.name}`,
      businessId: bizId,
    },
  ];
  if (bizCashToPersonal > 0) {
    ledgerAdded.push({
      id: `close-cash-${bizId}-${tick}`,
      tick,
      amount: bizCashToPersonal,
      category: "personal",
      memo: `Cash returned on close: ${biz.name}`,
      businessId: bizId,
    });
  }

  // --- Postmortem record ---
  const record: ClosedBusinessRecord = {
    id: bizId,
    name: biz.name,
    type: biz.type,
    marketId: biz.locationId,
    openedAtTick: biz.openedAtTick,
    closedAtTick: tick,
    closedReason: reason,
    peakWeeklyRevenueCents:
      biz.kpis.peakWeeklyRevenue ?? biz.kpis.weeklyRevenue,
    finalCashCents: biz.cash,
    liquidationProceedsCents: grossProceeds,
    unsecuredDebtFromLoanCents: outstandingLoanBalance,
    creditImpact: creditDelta,
  };

  // --- Closure announcement event ---
  const closureEvent: GameEvent = {
    id: `close-evt-${bizId}-${tick}`,
    tick,
    kind: "business_event",
    title:
      reason === "liquidation"
        ? `Liquidated: ${biz.name}`
        : `Closed: ${biz.name}`,
    detail: buildCloseDetail({
      biz,
      reason,
      recoveryRate,
      grossProceeds,
      outstandingLoanBalance,
      prevCredit: state.player.creditScore,
      nextCredit,
    }),
    dismissed: false,
    blocking: true,
  };

  // --- State assembly ---
  const nextBusinesses: Record<Id, Business> = { ...state.businesses };
  delete nextBusinesses[bizId];

  // Drop this biz from its market's businessIds list.
  const market = state.markets[biz.locationId];
  const nextMarkets = market
    ? {
        ...state.markets,
        [biz.locationId]: {
          ...market,
          businessIds: market.businessIds.filter((id) => id !== bizId),
        },
      }
    : state.markets;

  // Free any hosted property. Player retains ownership — the building is
  // theirs; the business that occupied it is gone.
  let nextProperties = state.properties;
  if (biz.propertyId) {
    const prop = state.properties[biz.propertyId];
    if (prop && prop.hostedBusinessId === bizId) {
      nextProperties = {
        ...state.properties,
        [biz.propertyId]: { ...prop, hostedBusinessId: undefined },
      };
    }
  }

  // Strip any business-loans attached to this biz; their balances have
  // been rolled into personalUnsecuredDebtCents.
  const nextBusinessLoans = { ...(state.businessLoans ?? {}) };
  for (const l of attachedLoans) {
    delete nextBusinessLoans[l.id];
  }

  const nextPlayer = {
    ...state.player,
    personalCash:
      state.player.personalCash + grossProceeds + bizCashToPersonal,
    personalUnsecuredDebtCents:
      state.player.personalUnsecuredDebtCents + outstandingLoanBalance,
    creditScore: nextCredit,
    closedBusinesses: {
      ...state.player.closedBusinesses,
      [bizId]: record,
    },
  };

  const nextState: GameState = {
    ...state,
    businesses: nextBusinesses,
    markets: nextMarkets,
    properties: nextProperties,
    businessLoans: nextBusinessLoans,
    player: nextPlayer,
    ledger: [...state.ledger, ...ledgerAdded],
    events: [...state.events, closureEvent],
  };

  return { ok: true, state: nextState, record, event: closureEvent };
}

/**
 * Thin named wrapper: the engine tick's insolvency state machine calls
 * this when a business hits 4 consecutive distressed weeks.
 */
export function liquidateBusiness(
  state: GameState,
  bizId: Id,
  tick: Tick,
): CloseBusinessResult {
  return closeBusiness(state, bizId, "liquidation", tick);
}

/**
 * Thin named wrapper: UI store action for the player-initiated close.
 */
export function closeBusinessVoluntarily(
  state: GameState,
  bizId: Id,
  tick: Tick,
): CloseBusinessResult {
  return closeBusiness(state, bizId, "voluntary_close", tick);
}

// ---------- helpers ----------

function buildCloseDetail(args: {
  biz: Business;
  reason: CloseReason;
  recoveryRate: number;
  grossProceeds: number;
  outstandingLoanBalance: number;
  prevCredit: number;
  nextCredit: number;
}): string {
  const {
    biz,
    reason,
    recoveryRate,
    grossProceeds,
    outstandingLoanBalance,
    prevCredit,
    nextCredit,
  } = args;

  const lead =
    reason === "liquidation"
      ? `${biz.name} was forced into liquidation after 4 weeks underwater.`
      : `${biz.name} was closed voluntarily.`;

  const valuation = `Assets sold for ${formatMoney(grossProceeds)} (${Math.round(recoveryRate * 100)}% of book).`;

  const debt =
    outstandingLoanBalance > 0
      ? ` Outstanding loan balance ${formatMoney(outstandingLoanBalance)} collapsed to your personal guarantee.`
      : "";

  const credit = ` Credit ${prevCredit} → ${nextCredit}.`;

  return `${lead} ${valuation}${debt}${credit}`;
}
