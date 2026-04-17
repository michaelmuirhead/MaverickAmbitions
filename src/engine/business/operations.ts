/**
 * Business operation helpers that are not specific to a type.
 *
 * Things like "rename business", "transfer cash between businesses", and
 * "close business" live here. Keep this free of type-specific logic.
 */

import type { Business, Cents, LedgerEntry, Tick } from "@/types/game";

import { ledger } from "../economy/finance";

export function renameBusiness(biz: Business, name: string): Business {
  return { ...biz, name };
}

export function transferCashBetweenBusinesses(
  from: Business,
  to: Business,
  amount: Cents,
  tick: Tick,
): { from: Business; to: Business; ledger: LedgerEntry[] } {
  if (from.cash < amount) throw new Error("Insufficient cash to transfer");
  const out: LedgerEntry[] = [
    ledger(
      `xfr-out-${from.id}-${tick}`,
      tick,
      -amount,
      "other",
      `Transfer to ${to.name}`,
      from.id,
    ),
    ledger(
      `xfr-in-${to.id}-${tick}`,
      tick,
      amount,
      "other",
      `Transfer from ${from.name}`,
      to.id,
    ),
  ];
  return {
    from: { ...from, cash: from.cash - amount },
    to: { ...to, cash: to.cash + amount },
    ledger: out,
  };
}
