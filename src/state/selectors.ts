import type { Business, Cents, GameState, Property } from "@/types/game";

import {
  creditBand,
  mortgageRate,
  type CreditBand,
} from "@/engine/economy/realEstate";
import { playerBusinessLoanDebt } from "@/engine/economy/businessLoan";
import { getEventBanners, type EventBanner } from "@/engine/macro/events";

export function selectNetWorth(state: GameState): Cents {
  const personal = state.player.personalCash;
  const bizCash = Object.values(state.businesses)
    .filter((b) => b.ownerId === state.player.id)
    .reduce((acc, b) => acc + b.cash, 0);
  const realEstate = selectPlayerRealEstateEquity(state);
  const businessLoanDebt = selectPlayerBusinessLoanDebt(state);
  return personal + bizCash + realEstate - businessLoanDebt;
}

/** Outstanding business-loan principal the player is carrying. */
export function selectPlayerBusinessLoanDebt(state: GameState): Cents {
  return playerBusinessLoanDebt(state);
}

/** Current market equity in all player-owned properties (value minus mortgage balance). */
export function selectPlayerRealEstateEquity(state: GameState): Cents {
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

/** Outstanding mortgage balance the player is carrying. */
export function selectPlayerMortgageDebt(state: GameState): Cents {
  let total = 0;
  for (const prop of Object.values(state.properties)) {
    if (prop.ownerId !== state.player.id) continue;
    if (!prop.mortgageId) continue;
    total += state.mortgages[prop.mortgageId]?.balance ?? 0;
  }
  return total;
}

/** All properties owned by the player. */
export function selectPlayerProperties(state: GameState): Property[] {
  return Object.values(state.properties).filter(
    (p) => p.ownerId === state.player.id,
  );
}

/** Available listings in a market (for sale). */
export function selectListingsInMarket(
  state: GameState,
  marketId: string,
): Property[] {
  return Object.values(state.properties).filter(
    (p) =>
      p.marketId === marketId &&
      p.listPriceCents !== undefined &&
      p.ownerId !== state.player.id,
  );
}

export interface CreditProfile {
  score: number;
  band: CreditBand;
  /** Rate (0..1) the player would currently get on a new mortgage. */
  quotedMortgageRate: number;
  /** Total missed mortgage payments this year across the player's loans. */
  missedThisYear: number;
}

export function selectCreditProfile(state: GameState): CreditProfile {
  const band = creditBand(state.player.creditScore);
  const quotedMortgageRate = mortgageRate(state.macro, state.player.creditScore);
  let missedThisYear = 0;
  for (const prop of Object.values(state.properties)) {
    if (prop.ownerId !== state.player.id || !prop.mortgageId) continue;
    const loan = state.mortgages[prop.mortgageId];
    if (loan?.missedPaymentsThisYear) missedThisYear += loan.missedPaymentsThisYear;
  }
  return {
    score: state.player.creditScore,
    band,
    quotedMortgageRate,
    missedThisYear,
  };
}

export function selectPlayerBusinesses(state: GameState): Business[] {
  return Object.values(state.businesses).filter(
    (b) => b.ownerId === state.player.id,
  );
}

export function selectWeeklyPL(state: GameState): {
  revenue: Cents;
  expenses: Cents;
  profit: Cents;
} {
  const biz = selectPlayerBusinesses(state);
  const revenue = biz.reduce((a, b) => a + b.kpis.weeklyRevenue, 0);
  const expenses = biz.reduce((a, b) => a + b.kpis.weeklyExpenses, 0);
  return { revenue, expenses, profit: revenue - expenses };
}

export function selectActiveEvents(state: GameState) {
  return state.events.filter((e) => !e.dismissed).slice(-20).reverse();
}

/**
 * v0.5 macro shocks currently in effect, sorted by severity then recency.
 * Each banner knows how many weeks are left and carries tone/severity for
 * the UI to style. Distinct from `selectActiveEvents` which surfaces the
 * rolling list of per-business notifications.
 */
export function selectMacroBanners(state: GameState): EventBanner[] {
  return getEventBanners(state, state.clock.tick);
}

export function selectRivalsLeaderboard(state: GameState) {
  return Object.values(state.rivals)
    .map((r) => ({
      id: r.id,
      name: r.name,
      netWorth: r.netWorth,
      businesses: r.businessIds.length,
      lastMove: r.lastMove?.description ?? "—",
    }))
    .sort((a, b) => b.netWorth - a.netWorth);
}
