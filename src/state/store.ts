/**
 * Root Zustand store. One top-level `game: GameState` slice to keep the
 * save/load boundary simple. UI reads via memoized selectors in
 * `state/selectors.ts`.
 */

"use client";

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { setAutoFreeze } from "immer";

// Game-engine concession: our per-business tick modules (retail/cafe/hospitality)
// update state in-place for speed (`state.wagesAccrued += ...`). Immer's default
// deep-freeze would turn those mutations into TypeErrors in production and
// silently wedge the game clock. Turn it off globally. The long-term fix is to
// make onHour/onDay/onWeek return fresh state, but this keeps v0.6 unblocked.
setAutoFreeze(false);

import type {
  Business,
  BusinessTypeId,
  Cents,
  GameSpeed,
  GameState,
  Id,
  MacroEventId,
} from "@/types/game";

import { nanoid } from "nanoid";

import { AUTOSAVE_SLOT, loadGame, newGame, saveGame, stepTick } from "@/engine";
import { getBusinessModule } from "@/engine/business/registry";
import {
  originateMortgage,
  refinanceMortgage,
} from "@/engine/economy/realEstate";
import { originateBusinessLoan } from "@/engine/economy/businessLoan";
import { forceActivate } from "@/engine/macro/events";
import { dollars } from "@/lib/money";
import { selectNetWorth } from "./selectors";

interface GameActions {
  /** Start a brand-new game. */
  startNew: (opts?: { founderName?: string; difficulty?: 1 | 2 | 3 | 4 | 5 }) => void;
  /** Hydrate from a save slot. Returns true on success. */
  loadSlot: (slot?: string) => boolean;
  /** Autosave to the current slot. */
  autoSave: () => void;
  /** Advance one tick. */
  tick: () => void;
  /** Change game speed. */
  setSpeed: (s: GameSpeed) => void;
  /** Open a business of any registered type at a given market. Enforces unlock + cash gates.
   * If `opts.financing.borrowCents` is set, an SBA-style business loan is originated
   * for that amount (credit-gated, capped by LTC). The player covers the remainder
   * from personal cash; the borrowed principal is added to the new business's cash. */
  openBusiness: (
    type: BusinessTypeId,
    marketId: Id,
    name: string,
    opts?: { propertyId?: Id; financing?: { borrowCents: Cents } },
  ) => { ok: boolean; error?: string; businessId?: Id; loanId?: Id };
  /** Open a corner store at a given market. Kept as a convenience for existing callers. */
  openCornerStore: (marketId: Id, name: string) => { ok: boolean; error?: string; businessId?: Id };
  /** Buy a listed property. Originates a mortgage if down payment < list. */
  buyProperty: (
    propertyId: Id,
    downPaymentCents: Cents,
  ) => { ok: boolean; error?: string; mortgageId?: Id };
  /** Sell an owned property at a given sale price (defaults to appraised). */
  sellProperty: (
    propertyId: Id,
    salePriceCents?: Cents,
  ) => { ok: boolean; error?: string; proceedsCents?: Cents };
  /** Refinance an existing player-owned mortgage at the current rate + credit spread. */
  refinance: (mortgageId: Id) => { ok: boolean; error?: string; newPaymentCents?: Cents };
  /** Dismiss a game event. */
  dismissEvent: (id: Id) => void;
  /** Apply a business state patch (e.g. UI edits pricing). */
  patchBusinessState: (id: Id, patch: Partial<Business["state"]>) => void;
  /** Debug: force-activate a macro shock at the current tick. */
  debugForceMacroEvent: (defId: MacroEventId) => void;
  /** Debug: clear all active macro shocks without moving them to history. */
  debugClearMacroEvents: () => void;
}

export interface GameStore extends GameActions {
  /** Live game state (or undefined before a game is started/loaded). */
  game?: GameState;
  /** Wall-clock ms per tick based on speed. */
  tickIntervalMs: number;
}

function speedToIntervalMs(speed: GameSpeed): number {
  switch (speed) {
    case 0:
      return Number.POSITIVE_INFINITY;
    case 1:
      return 2000;
    case 2:
      return 1000;
    case 4:
      return 500;
    case 8:
      return 250;
  }
}

export const useGameStore = create<GameStore>()(
  immer((set, get) => ({
    game: undefined,
    tickIntervalMs: 2000,

    startNew: (opts) => {
      const g = newGame({ founderName: opts?.founderName, difficulty: opts?.difficulty });
      set((s) => {
        s.game = g;
        s.tickIntervalMs = speedToIntervalMs(g.clock.speed);
      });
    },

    loadSlot: (slot = AUTOSAVE_SLOT) => {
      const loaded = loadGame(slot);
      if (!loaded) return false;
      set((s) => {
        s.game = loaded;
        s.tickIntervalMs = speedToIntervalMs(loaded.clock.speed);
      });
      return true;
    },

    autoSave: () => {
      const g = get().game;
      if (!g) return;
      saveGame(AUTOSAVE_SLOT, g);
    },

    tick: () => {
      const g = get().game;
      if (!g) return;
      if (g.clock.speed === 0) return;
      const next = stepTick(g);
      set((s) => {
        s.game = next;
      });
    },

    setSpeed: (speed) => {
      set((s) => {
        if (!s.game) return;
        s.game.clock.speed = speed;
        s.tickIntervalMs = speedToIntervalMs(speed);
      });
    },

    openBusiness: (type, marketId, name, opts) => {
      const g = get().game;
      if (!g) return { ok: false, error: "No active game" };
      let mod;
      try {
        mod = getBusinessModule(type);
      } catch {
        return { ok: false, error: `Business type '${type}' not implemented yet.` };
      }
      const cost = mod.startup.startupCostCents;

      // --- Financing path: validate up front before any state mutation ---
      const borrowCents = opts?.financing?.borrowCents ?? 0;
      const downPayment = cost - borrowCents;
      if (borrowCents < 0 || borrowCents > cost) {
        return { ok: false, error: "Invalid financing amount." };
      }
      if (g.player.personalCash < downPayment) {
        if (borrowCents > 0) {
          return {
            ok: false,
            error: `Need $${Math.round(downPayment / 100).toLocaleString()} personal cash as down payment (after $${Math.round(borrowCents / 100).toLocaleString()} financing).`,
          };
        }
        return {
          ok: false,
          error: `Need $${Math.round(cost / 100).toLocaleString()} in personal cash to open.`,
        };
      }

      const unlockNetWorth = mod.startup.unlocksAt?.netWorthCents;
      if (unlockNetWorth !== undefined) {
        const nw = selectNetWorth(g);
        if (nw < unlockNetWorth) {
          return {
            ok: false,
            error: `${mod.ui.label} unlocks at $${Math.round(unlockNetWorth / 100).toLocaleString()} net worth (you're at $${Math.round(nw / 100).toLocaleString()}).`,
          };
        }
      }
      if (!g.markets[marketId]) return { ok: false, error: "Market not found" };

      // Optional property hosting: must be owned by player, in this market, and vacant.
      const propertyId = opts?.propertyId;
      if (propertyId) {
        const prop = g.properties[propertyId];
        if (!prop) return { ok: false, error: "Property not found" };
        if (prop.marketId !== marketId) {
          return { ok: false, error: "Property is in a different market." };
        }
        if (prop.ownerId !== g.player.id) {
          return { ok: false, error: "You don't own that property." };
        }
        if (prop.hostedBusinessId) {
          return { ok: false, error: "That property is already hosting a business." };
        }
      }

      // Origination must happen before commit — we need to know if the
      // loan would even be approved, or fall back to a clean error return.
      const id = nanoid(8);
      let loanId: Id | undefined;
      const loanResult = borrowCents > 0
        ? originateBusinessLoan({
            id: nanoid(8),
            businessId: id,
            startupCostCents: cost,
            borrowCents,
            creditScore: g.player.creditScore,
            macro: g.macro,
            tick: g.clock.tick,
          })
        : undefined;
      if (loanResult && !loanResult.ok) {
        return { ok: false, error: loanResult.error ?? "Loan denied." };
      }
      if (loanResult && loanResult.loan) {
        loanId = loanResult.loan.id;
      }

      const biz = mod.create({
        id,
        ownerId: g.player.id,
        name,
        locationId: marketId,
        tick: g.clock.tick,
        seed: g.seed,
      });
      // Loan proceeds go into business operating cash on top of its
      // default float — this is the realistic SBA flow and prevents
      // instant cash-starvation in month 1.
      if (loanResult && loanResult.loan) {
        biz.cash += loanResult.loan.principal;
      }

      set((s) => {
        if (!s.game) return;
        s.game.player.personalCash -= downPayment;
        // If this business sits on an owned property, suppress its rent draw
        // and link both directions so monthly settlement can find it.
        if (propertyId) {
          const st = biz.state as Record<string, unknown>;
          st.rentMonthly = 0;
          biz.propertyId = propertyId;
          s.game.properties[propertyId]!.hostedBusinessId = id;
        }
        s.game.businesses[id] = biz;
        s.game.markets[marketId]!.businessIds.push(id);
        if (loanResult && loanResult.loan) {
          s.game.businessLoans[loanResult.loan.id] = loanResult.loan;
          s.game.ledger.push({
            id: `bloan-open-${loanResult.loan.id}-${s.game.clock.tick}`,
            tick: s.game.clock.tick,
            amount: loanResult.loan.principal,
            category: "business_loan_proceeds",
            memo: `Business loan: ${mod.ui.label} @ ${(loanResult.loan.annualRate * 100).toFixed(2)}%`,
            businessId: id,
          });
        }
      });
      void dollars; // keep money helper import alive
      return { ok: true, businessId: id, loanId };
    },

    openCornerStore: (marketId, name) => {
      return get().openBusiness("corner_store", marketId, name);
    },

    buyProperty: (propertyId, downPaymentCents) => {
      const g = get().game;
      if (!g) return { ok: false, error: "No active game" };
      const prop = g.properties[propertyId];
      if (!prop) return { ok: false, error: "Property not found" };
      if (prop.ownerId === g.player.id) {
        return { ok: false, error: "You already own this property." };
      }
      if (prop.listPriceCents === undefined) {
        return { ok: false, error: "Property is not for sale." };
      }
      if (downPaymentCents > g.player.personalCash) {
        return {
          ok: false,
          error: `Need $${Math.round(downPaymentCents / 100).toLocaleString()} in personal cash for the down payment.`,
        };
      }

      const loanId = nanoid(8);
      const res = originateMortgage({
        id: loanId,
        propertyId,
        purchasePriceCents: prop.listPriceCents,
        downPaymentCents,
        creditScore: g.player.creditScore,
        macro: g.macro,
        tick: g.clock.tick,
      });
      if (!res.ok || !res.loan) {
        return { ok: false, error: res.error ?? "Origination failed." };
      }

      const loan = res.loan;
      set((s) => {
        if (!s.game) return;
        s.game.player.personalCash -= downPaymentCents;
        // Only store a mortgage if there's actually a principal balance.
        if (loan.balance > 0) {
          s.game.mortgages[loan.id] = loan;
          s.game.properties[propertyId]!.mortgageId = loan.id;
        }
        s.game.properties[propertyId]!.ownerId = s.game.player.id;
        s.game.properties[propertyId]!.purchasePriceCents = prop.listPriceCents!;
        s.game.properties[propertyId]!.purchaseTick = s.game.clock.tick;
        // Delist from the sale market; owner may re-list later.
        s.game.properties[propertyId]!.listPriceCents = undefined;
        // Book the cash movement in the ledger so the Finance tab sees it.
        s.game.ledger.push({
          id: `buy-${propertyId}-${s.game.clock.tick}`,
          tick: s.game.clock.tick,
          amount: -downPaymentCents,
          category: "property_purchase",
          memo: `Down payment: ${prop.address}`,
        });
      });
      return {
        ok: true,
        mortgageId: loan.balance > 0 ? loan.id : undefined,
      };
    },

    sellProperty: (propertyId, salePriceCents) => {
      const g = get().game;
      if (!g) return { ok: false, error: "No active game" };
      const prop = g.properties[propertyId];
      if (!prop) return { ok: false, error: "Property not found" };
      if (prop.ownerId !== g.player.id) {
        return { ok: false, error: "You don't own that property." };
      }
      if (prop.hostedBusinessId) {
        return { ok: false, error: "Close the hosted business before selling." };
      }
      const price = salePriceCents ?? prop.valueCents;
      const mortBal = prop.mortgageId
        ? (g.mortgages[prop.mortgageId]?.balance ?? 0)
        : 0;
      if (price < mortBal) {
        return {
          ok: false,
          error: `Sale price ($${Math.round(price / 100).toLocaleString()}) below mortgage balance ($${Math.round(mortBal / 100).toLocaleString()}).`,
        };
      }
      const proceeds = price - mortBal;
      set((s) => {
        if (!s.game) return;
        s.game.player.personalCash += proceeds;
        if (prop.mortgageId) {
          delete s.game.mortgages[prop.mortgageId];
        }
        // Return to absentee pool and re-list at appraised.
        s.game.properties[propertyId]!.ownerId = undefined;
        s.game.properties[propertyId]!.mortgageId = undefined;
        s.game.properties[propertyId]!.purchasePriceCents = 0;
        s.game.properties[propertyId]!.purchaseTick = undefined;
        s.game.properties[propertyId]!.listPriceCents = price;
        s.game.ledger.push({
          id: `sell-${propertyId}-${s.game.clock.tick}`,
          tick: s.game.clock.tick,
          amount: +proceeds,
          category: "property_sale",
          memo: `Sale proceeds: ${prop.address}`,
        });
      });
      return { ok: true, proceedsCents: proceeds };
    },

    refinance: (mortgageId) => {
      const g = get().game;
      if (!g) return { ok: false, error: "No active game" };
      const loan = g.mortgages[mortgageId];
      if (!loan) return { ok: false, error: "Mortgage not found" };
      // Confirm the player owns the underlying property.
      const prop = loan.propertyId ? g.properties[loan.propertyId] : undefined;
      if (!prop || prop.ownerId !== g.player.id) {
        return { ok: false, error: "Only your own mortgages can be refinanced." };
      }
      const newId = nanoid(8);
      const res = refinanceMortgage(loan, g.player.creditScore, g.macro, g.clock.tick, newId);
      if (!res.ok || !res.loan) {
        return { ok: false, error: res.error ?? "Refi failed." };
      }
      const nextLoan = res.loan;
      set((s) => {
        if (!s.game) return;
        delete s.game.mortgages[mortgageId];
        s.game.mortgages[nextLoan.id] = nextLoan;
        s.game.properties[prop.id]!.mortgageId = nextLoan.id;
        s.game.ledger.push({
          id: `refi-${nextLoan.id}-${s.game.clock.tick}`,
          tick: s.game.clock.tick,
          amount: 0,
          category: "other",
          memo: `Refinanced ${prop.address} at ${(nextLoan.annualRate * 100).toFixed(2)}%`,
        });
      });
      return { ok: true, newPaymentCents: nextLoan.monthlyPayment };
    },

    dismissEvent: (id) => {
      set((s) => {
        if (!s.game) return;
        const idx = s.game.events.findIndex((e) => e.id === id);
        if (idx >= 0) s.game.events[idx]!.dismissed = true;
      });
    },

    patchBusinessState: (id, patch) => {
      set((s) => {
        if (!s.game) return;
        const biz = s.game.businesses[id];
        if (!biz) return;
        biz.state = { ...biz.state, ...patch };
      });
    },

    debugForceMacroEvent: (defId) => {
      const g = get().game;
      if (!g) return;
      const { active, gameEvent, ledger } = forceActivate(g, defId, g.clock.tick);
      set((s) => {
        if (!s.game) return;
        s.game.activeEvents = [...(s.game.activeEvents ?? []), active];
        s.game.events.push(gameEvent);
        s.game.ledger.push(ledger);
      });
    },

    debugClearMacroEvents: () => {
      set((s) => {
        if (!s.game) return;
        s.game.activeEvents = [];
      });
    },
  })),
);
