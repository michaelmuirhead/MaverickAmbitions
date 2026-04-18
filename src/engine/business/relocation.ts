/**
 * Relocation — lease ↔ owned transitions for a live business (v0.9).
 *
 * Two operations, both pure functions that take `state` and return
 * `{ ok, state?, ... }` snapshots. The store actions wrap these.
 *
 *   1. `convertBusinessToOwned(state, bizId, propertyId, tick)`
 *      A leased business moves onto a vacant player-owned property.
 *      Wipes `state.rentMonthly` (engine reads this weekly at /4), links
 *      `biz.propertyId ↔ property.hostedBusinessId`, and records a ledger
 *      memo. No cash changes hands — the property was already bought.
 *
 *   2. `convertBusinessToLease(state, bizId, tick)`
 *      A business currently hosted on an owned property goes back to a
 *      commercial lease. Charges a 2-month deposit from business cash
 *      (falls back to the player's personal cash if the biz is short).
 *      Resets `state.rentMonthly` to the module's default (derived by
 *      probing `mod.create`). Clears the hosted link so a follow-up
 *      `sellProperty` succeeds.
 *
 *      If neither the business nor the player can afford the 2-month
 *      deposit, returns { ok: false, insufficientFunds: true } — the
 *      caller (sell-hosted-property flow) is expected to fall back to
 *      `closeBusinessVoluntarily` in that case.
 */

import type { Business, Cents, GameState, Id, Tick } from "@/types/game";
import { getBusinessModule } from "./registry";

export interface RelocationResult {
  ok: boolean;
  error?: string;
  /** New game-state snapshot when ok. */
  state?: GameState;
  /** For lease conversion: the 2-month deposit actually paid. */
  depositCents?: Cents;
  /** True iff ok=false because the 2-month deposit was unaffordable. */
  insufficientFunds?: boolean;
}

/**
 * Move a currently-leased business onto a vacant player-owned property.
 * No cash changes hands — the property was already bought.
 */
export function convertBusinessToOwned(
  state: GameState,
  bizId: Id,
  propertyId: Id,
  tick: Tick,
): RelocationResult {
  const biz = state.businesses[bizId];
  if (!biz) return { ok: false, error: "Business not found." };
  if (biz.ownerId !== state.player.id) {
    return { ok: false, error: "You don't own that business." };
  }
  if (biz.propertyId) {
    return {
      ok: false,
      error: "This business already sits on an owned property.",
    };
  }
  const prop = state.properties[propertyId];
  if (!prop) return { ok: false, error: "Property not found." };
  if (prop.ownerId !== state.player.id) {
    return { ok: false, error: "You don't own that property." };
  }
  if (prop.hostedBusinessId) {
    return {
      ok: false,
      error: "That property is already hosting a business.",
    };
  }
  if (prop.marketId !== biz.locationId) {
    return {
      ok: false,
      error: "Property is in a different market than the business.",
    };
  }

  const nextBiz: Business = {
    ...biz,
    propertyId,
    state: {
      ...biz.state,
      rentMonthly: 0,
    },
  };

  const nextState: GameState = {
    ...state,
    businesses: {
      ...state.businesses,
      [bizId]: nextBiz,
    },
    properties: {
      ...state.properties,
      [propertyId]: { ...prop, hostedBusinessId: bizId },
    },
    ledger: [
      ...state.ledger,
      {
        id: `relocate-own-${bizId}-${tick}`,
        tick,
        amount: 0,
        category: "other",
        memo: `${biz.name} moved onto owned property ${prop.address} — rent line zeroed.`,
        businessId: bizId,
      },
    ],
  };

  return { ok: true, state: nextState };
}

/**
 * Move a currently-hosted business back to a commercial lease. Charges
 * a 2-month deposit from the business's operating cash, with the
 * player's personal cash as fallback. Returns `insufficientFunds: true`
 * when even the fallback can't cover.
 */
export function convertBusinessToLease(
  state: GameState,
  bizId: Id,
  tick: Tick,
): RelocationResult {
  const biz = state.businesses[bizId];
  if (!biz) return { ok: false, error: "Business not found." };
  if (biz.ownerId !== state.player.id) {
    return { ok: false, error: "You don't own that business." };
  }
  if (!biz.propertyId) {
    return { ok: false, error: "This business isn't on an owned property." };
  }
  const prop = state.properties[biz.propertyId];
  if (!prop) return { ok: false, error: "Hosted property record missing." };

  // Probe the module for the default rentMonthly by creating a throwaway
  // business of the same type. Every storefront/hospitality/project
  // engine sets rentMonthly inline in `create`, so this gives us the
  // canonical value without duplicating the configs here.
  const mod = getBusinessModule(biz.type);
  const probe = mod.create({
    id: `${bizId}-probe`,
    ownerId: biz.ownerId,
    name: biz.name,
    locationId: biz.locationId,
    tick: biz.openedAtTick,
    seed: `${bizId}-probe`,
  });
  const defaultRentMonthly = Math.max(
    0,
    Number(
      (probe.state as { rentMonthly?: number }).rentMonthly ?? 0,
    ),
  ) as Cents;

  // 2-month deposit payable before the first lease cycle. If the module
  // has no rent line (e.g. food truck) just unlink without charging —
  // the hosted flag was a bookkeeping quirk.
  const deposit = (defaultRentMonthly * 2) as Cents;

  const bizCash = biz.cash as number;
  const playerCash = state.player.personalCash as number;
  const combined = bizCash + playerCash;
  if (deposit > 0 && combined < deposit) {
    return {
      ok: false,
      insufficientFunds: true,
      error: `Need ${formatCents(deposit)} for a 2-month lease deposit — operating cash + personal cash only total ${formatCents(combined as Cents)}.`,
    };
  }

  // Pay from biz first, then top up from player.
  const fromBiz = Math.min(bizCash, deposit);
  const fromPlayer = deposit - fromBiz;

  const nextBiz: Business = {
    ...biz,
    cash: (bizCash - fromBiz) as Cents,
    propertyId: undefined,
    state: {
      ...biz.state,
      rentMonthly: defaultRentMonthly,
    },
  };

  const nextState: GameState = {
    ...state,
    player: {
      ...state.player,
      personalCash: (playerCash - fromPlayer) as Cents,
    },
    businesses: {
      ...state.businesses,
      [bizId]: nextBiz,
    },
    properties: {
      ...state.properties,
      [biz.propertyId]: { ...prop, hostedBusinessId: undefined },
    },
    ledger: deposit > 0
      ? [
          ...state.ledger,
          {
            id: `relocate-lease-${bizId}-${tick}`,
            tick,
            amount: (-deposit) as Cents,
            category: "rent",
            memo: `${biz.name} relocated to a lease — 2-month deposit ${formatCents(deposit)} (${formatCents(fromBiz as Cents)} biz + ${formatCents(fromPlayer as Cents)} personal).`,
            businessId: bizId,
          },
        ]
      : [
          ...state.ledger,
          {
            id: `relocate-lease-${bizId}-${tick}`,
            tick,
            amount: 0 as Cents,
            category: "other",
            memo: `${biz.name} unlinked from ${prop.address} — no rent line for this business type.`,
            businessId: bizId,
          },
        ],
  };

  return { ok: true, state: nextState, depositCents: deposit };
}

function formatCents(c: Cents): string {
  return `$${Math.round((c as number) / 100).toLocaleString()}`;
}
