/**
 * Rival strategy: scores candidate moves and picks the best given
 * personality + difficulty. Rivals play by the same rules as the
 * player — they buy real businesses, spend real cash, can go bankrupt.
 *
 * Move space:
 *   - open_business(type): corner_store or cafe. Cafes are gated by the
 *     unlock (net worth) and by personality — operators favor quality
 *     plays, disruptors prefer high-volume pricing plays.
 *   - invest_marketing / hire_staff: type-agnostic knobs.
 *   - price_war: works for both corner stores (skus) and cafes (menu).
 */

import { nanoid } from "nanoid";

import type {
  AIRival,
  Business,
  BusinessTypeId,
  GameState,
  Tick,
} from "@/types/game";

import { dollars } from "@/lib/money";
import type { RNG } from "@/lib/rng";

import {
  getAvailableBusinessTypes,
  getBusinessModule,
} from "../business/registry";
import { originateMortgage } from "../economy/realEstate";
import { DIFFICULTY } from "./difficulty";
import { PERSONALITIES } from "./personality";
import { getRivalEventBias } from "./rivalReactions";

/** Abstract credit score for a rival, derived from their net worth. */
function rivalCreditScore(netWorth: number): number {
  // Thin approximation: more capital → better access to credit.
  if (netWorth >= 5_000_000_00) return 780;
  if (netWorth >= 1_000_000_00) return 740;
  if (netWorth >= 250_000_00) return 700;
  if (netWorth >= 75_000_00) return 660;
  if (netWorth >= 25_000_00) return 620;
  return 580;
}

/** True if the personality is disposed to owning real estate. */
function prefersOwnership(personality: keyof typeof PERSONALITIES): boolean {
  return personality === "operator" || personality === "tycoon";
}

export type RivalMove =
  | {
      kind: "open_business";
      businessType: BusinessTypeId;
      marketId: string;
      estimatedUtility: number;
    }
  | {
      kind: "price_war";
      businessId: string;
      targetBusinessId: string;
      estimatedUtility: number;
    }
  | {
      kind: "invest_marketing";
      businessId: string;
      amountCents: number;
      estimatedUtility: number;
    }
  | { kind: "hire_staff"; businessId: string; estimatedUtility: number }
  | {
      kind: "buy_property";
      propertyId: string;
      downPaymentCents: number;
      estimatedUtility: number;
    }
  | { kind: "no_op"; estimatedUtility: number };

/**
 * Per-type bias: how much a personality prefers one type over another.
 * Cafe plays are a quality/brand bet — operators & tycoons lean in.
 * Corner stores are a volume/pricing bet — disruptors & predators lean in.
 */
function typeBias(
  type: BusinessTypeId,
  personality: keyof typeof PERSONALITIES,
): number {
  const p = PERSONALITIES[personality];
  if (type === "cafe") {
    // Favored by high ethics + acquisition, penalized by priceWarBias.
    return 1 + (p.ethics - 0.5) * 0.6 + p.acquisitionBias * 0.4 - p.priceWarBias * 0.3;
  }
  if (type === "restaurant") {
    // Restaurants are capital-heavy quality plays — strong skew toward
    // tycoons & operators, penalty for pure disruptors.
    return 1 + p.acquisitionBias * 0.5 + (p.ethics - 0.4) * 0.4 - p.priceWarBias * 0.4;
  }
  if (type === "bar") {
    // Bars skew toward aggressive operators (nightlife, volume margins);
    // predators like late-night revenue curves, tycoons less so.
    return 1 + p.aggression * 0.4 + p.acquisitionBias * 0.2 - (p.ethics - 0.5) * 0.2;
  }
  if (type === "corner_store") {
    // Favored by priceWarBias, baseline for everyone.
    return 1 + p.priceWarBias * 0.3 + (0.5 - p.ethics) * 0.2;
  }
  return 1;
}

/** Score candidate moves for one rival. */
export function enumerateMoves(
  rival: AIRival,
  state: GameState,
  rng: RNG,
): RivalMove[] {
  const eventBias = getRivalEventBias(rival, state.activeEvents ?? []);
  const moves: RivalMove[] = [
    { kind: "no_op", estimatedUtility: eventBias.noOpBoost },
  ];
  const pers = PERSONALITIES[rival.personality];
  const diff = DIFFICULTY[rival.difficulty];

  // Enumerate every available business type per market.
  const availableTypes = getAvailableBusinessTypes();
  for (const type of availableTypes) {
    let mod;
    try {
      mod = getBusinessModule(type);
    } catch {
      continue;
    }
    const cost = mod.startup.startupCostCents;
    if (rival.netWorth < cost) continue;
    const unlock = mod.startup.unlocksAt?.netWorthCents ?? 0;
    if (rival.netWorth < unlock) continue;

    for (const market of Object.values(state.markets)) {
      const sameTypeHere = market.businessIds.filter(
        (id) => state.businesses[id]?.type === type,
      ).length;
      // Saturation threshold differs by type. Hospitality crowds fast
      // (3 feels tight); restaurants crowd even faster (2–3 is already
      // noisy); retail tolerates more density (4).
      const saturationCeiling =
        type === "restaurant" ? 2 :
        type === "cafe" || type === "bar" ? 3 : 4;
      const saturation = sameTypeHere / saturationCeiling;
      const opportunity = Math.max(
        0,
        (1 - saturation) * market.desirability,
      );
      const bias = typeBias(type, rival.personality);
      // Cafes return less per unit of capital at first, but compound via halo;
      // we baseline a touch lower here and let the in-market competition play out.
      // Restaurants are even slower to cash-flow; bars sit between cafes and
      // corner stores.
      const baseline =
        type === "restaurant" ? 50 :
        type === "cafe" ? 55 :
        type === "bar" ? 58 :
        60;
      const typeEventMul = eventBias.typeUtilityMultiplier[type] ?? 1;
      const utility =
        opportunity * baseline * bias * (0.4 + pers.acquisitionBias) *
          eventBias.openBusinessMultiplier *
          typeEventMul -
        saturation * 30;
      moves.push({
        kind: "open_business",
        businessType: type,
        marketId: market.id,
        estimatedUtility:
          utility +
          rng.nextFloat(-diff.decisionNoise * 10, diff.decisionNoise * 10),
      });
    }
  }

  // Property purchase — only operators/tycoons really want to own.
  if (prefersOwnership(rival.personality)) {
    const creditScore = rivalCreditScore(rival.netWorth);
    for (const prop of Object.values(state.properties)) {
      if (prop.listPriceCents === undefined) continue;
      if (prop.ownerId === rival.id) continue;
      // Aim for a ~25% down (or whatever LTV allows).
      const targetDown = Math.round(prop.listPriceCents * 0.25);
      if (rival.netWorth < targetDown * 1.2) continue; // leave buffer
      const market = state.markets[prop.marketId];
      if (!market) continue;
      const utility =
        market.desirability * 30 +
        pers.acquisitionBias * 25 +
        (prop.class === "A" || prop.class === "trophy" ? 15 : 0) +
        eventBias.propertyBuyBoost +
        rng.nextFloat(-diff.decisionNoise * 8, diff.decisionNoise * 8);
      moves.push({
        kind: "buy_property",
        propertyId: prop.id,
        downPaymentCents: targetDown,
        estimatedUtility: utility,
      });
      void creditScore;
    }
  }

  // Existing-business moves.
  const myBizs = rival.businessIds
    .map((id) => state.businesses[id])
    .filter((b): b is Business => !!b);

  for (const biz of myBizs) {
    // Marketing
    moves.push({
      kind: "invest_marketing",
      businessId: biz.id,
      amountCents: dollars(250),
      estimatedUtility:
        (1 - (biz.kpis.marketShare ?? 0.2)) * 40 +
        eventBias.marketingBoost +
        rng.nextFloat(-diff.decisionNoise * 10, diff.decisionNoise * 10),
    });

    // Hire staff
    moves.push({
      kind: "hire_staff",
      businessId: biz.id,
      estimatedUtility:
        Math.max(0, biz.derived.stockLevel - 0.4) * 20 +
        (1 - biz.derived.riskScore / 100) * 10 +
        eventBias.hireStaffBoost +
        rng.nextFloat(-diff.decisionNoise * 10, diff.decisionNoise * 10),
    });

    // Price war against another business in the same market — only against
    // the SAME type (cafes undercut cafes, stores undercut stores).
    for (const id of state.markets[biz.locationId]?.businessIds ?? []) {
      const target = state.businesses[id];
      if (!target || target.id === biz.id) continue;
      if (target.ownerId === rival.id) continue;
      if (target.type !== biz.type) continue;
      moves.push({
        kind: "price_war",
        businessId: biz.id,
        targetBusinessId: target.id,
        estimatedUtility:
          pers.priceWarBias * 50 -
          (1 - pers.aggression) * 20 +
          rng.nextFloat(-diff.decisionNoise * 10, diff.decisionNoise * 10),
      });
    }
  }

  return moves;
}

/** Pick the best-scoring move. */
export function chooseMove(
  rival: AIRival,
  state: GameState,
  rng: RNG,
): RivalMove {
  const moves = enumerateMoves(rival, state, rng);
  moves.sort((a, b) => b.estimatedUtility - a.estimatedUtility);
  return moves[0] ?? { kind: "no_op", estimatedUtility: 0 };
}

function nameForNewBusiness(
  rival: AIRival,
  type: BusinessTypeId,
  index: number,
): string {
  if (type === "cafe") return `${rival.name} Roasters #${index}`;
  if (type === "corner_store") return `${rival.name} Convenience #${index}`;
  if (type === "bar") return `${rival.name}'s Tavern #${index}`;
  if (type === "restaurant") return `${rival.name} Kitchen #${index}`;
  return `${rival.name} ${type} #${index}`;
}

/** Apply a move, returning deltas as new state fragments. */
export function applyMove(
  rival: AIRival,
  move: RivalMove,
  state: GameState,
  tick: Tick,
  rng: RNG,
): Partial<GameState> & { lastMove: AIRival["lastMove"] } {
  switch (move.kind) {
    case "open_business": {
      let mod;
      try {
        mod = getBusinessModule(move.businessType);
      } catch {
        return {
          lastMove: {
            tick,
            description: `${rival.name} considered opening a ${move.businessType} but couldn't find a playbook.`,
          },
        };
      }
      const id = nanoid(8);
      const biz = mod.create({
        id,
        ownerId: rival.id,
        name: nameForNewBusiness(
          rival,
          move.businessType,
          rival.businessIds.length + 1,
        ),
        locationId: move.marketId,
        tick,
        seed: id,
      });
      const spend = mod.startup.startupCostCents;
      if (rival.netWorth < spend) {
        return {
          lastMove: {
            tick,
            description: `${rival.name} considered a new ${mod.ui.label.toLowerCase()} but lacked capital.`,
          },
        };
      }
      const rivals: Record<string, AIRival> = {
        ...state.rivals,
        [rival.id]: {
          ...rival,
          netWorth: rival.netWorth - spend,
          businessIds: [...rival.businessIds, id],
        },
      };
      const markets = {
        ...state.markets,
        [move.marketId]: {
          ...state.markets[move.marketId]!,
          businessIds: [...state.markets[move.marketId]!.businessIds, id],
        },
      };
      return {
        rivals,
        markets,
        businesses: { ...state.businesses, [id]: biz },
        lastMove: {
          tick,
          description: `${rival.name} opened a new ${mod.ui.label.toLowerCase()} in ${state.markets[move.marketId]?.name}.`,
        },
      };
    }
    case "invest_marketing": {
      const biz = state.businesses[move.businessId];
      if (!biz) return { lastMove: { tick, description: "Noop" } };
      const s = biz.state as unknown as {
        marketingScore?: number;
        marketingWeekly?: number;
      };
      const updated: Business = {
        ...biz,
        state: {
          ...(biz.state as object),
          marketingScore: Math.min(1, (s.marketingScore ?? 0) + 0.15),
          marketingWeekly: Math.max(
            (s.marketingWeekly ?? 0),
            move.amountCents,
          ),
        } as Record<string, unknown>,
      };
      return {
        businesses: { ...state.businesses, [biz.id]: updated },
        lastMove: {
          tick,
          description: `${rival.name} increased marketing at ${biz.name}.`,
        },
      };
    }
    case "hire_staff": {
      const biz = state.businesses[move.businessId];
      if (!biz) return { lastMove: { tick, description: "Noop" } };
      // Corner stores use `staff`; cafes use `baristas`. We write into whichever
      // array is present so this move works for both.
      const s = biz.state as unknown as {
        staff?: Array<{
          id: string;
          name: string;
          hourlyWageCents: number;
          skill: number;
          morale: number;
        }>;
        baristas?: Array<{
          id: string;
          name: string;
          hourlyWageCents: number;
          craft: number;
          morale: number;
        }>;
      };
      let nextState: Record<string, unknown> = { ...(biz.state as object) };
      let description = `${rival.name} hired at ${biz.name}.`;
      if (biz.type === "cafe") {
        const nextBaristas = [
          ...(s.baristas ?? []),
          {
            id: nanoid(6),
            name: `Barista ${rng.nextInt(1, 999)}`,
            hourlyWageCents: 2100,
            craft: rng.nextInt(35, 65),
            morale: rng.nextInt(55, 80),
          },
        ];
        nextState = { ...nextState, baristas: nextBaristas };
        description = `${rival.name} hired a barista at ${biz.name}.`;
      } else {
        const nextStaff = [
          ...(s.staff ?? []),
          {
            id: nanoid(6),
            name: `Hire ${rng.nextInt(1, 999)}`,
            hourlyWageCents: 1900,
            skill: rng.nextInt(30, 70),
            morale: rng.nextInt(50, 80),
          },
        ];
        nextState = { ...nextState, staff: nextStaff };
        description = `${rival.name} hired a new clerk at ${biz.name}.`;
      }
      const updated: Business = {
        ...biz,
        state: nextState as Record<string, unknown>,
      };
      return {
        businesses: { ...state.businesses, [biz.id]: updated },
        lastMove: { tick, description },
      };
    }
    case "price_war": {
      const biz = state.businesses[move.businessId];
      if (!biz) return { lastMove: { tick, description: "Noop" } };
      let nextState: Record<string, unknown> = { ...(biz.state as object) };

      if (biz.type === "cafe") {
        const s = biz.state as unknown as {
          menu?: Record<string, { price: number; referencePrice?: number }>;
        };
        const newMenu: Record<string, { price: number; referencePrice?: number }> = {
          ...(s.menu ?? {}),
        };
        for (const id of Object.keys(newMenu)) {
          const item = newMenu[id]!;
          newMenu[id] = {
            ...item,
            price: Math.max(1, Math.round(item.price * 0.92)),
          };
        }
        nextState = { ...nextState, menu: newMenu };
      } else {
        const s = biz.state as unknown as {
          skus?: Record<string, { price: number; referencePrice: number }>;
        };
        const newSkus: Record<string, { price: number; referencePrice: number }> = {
          ...(s.skus ?? {}),
        };
        for (const id of Object.keys(newSkus)) {
          const sku = newSkus[id]!;
          newSkus[id] = {
            ...sku,
            price: Math.max(1, Math.round(sku.price * 0.9)),
          };
        }
        nextState = { ...nextState, skus: newSkus };
      }

      const updated: Business = {
        ...biz,
        state: nextState as Record<string, unknown>,
      };
      const target = state.businesses[move.targetBusinessId];
      return {
        businesses: { ...state.businesses, [biz.id]: updated },
        lastMove: {
          tick,
          description: `${rival.name} slashed prices at ${biz.name}${target ? ` to undercut ${target.name}` : ""}.`,
        },
      };
    }
    case "buy_property": {
      const prop = state.properties[move.propertyId];
      if (!prop || prop.listPriceCents === undefined) {
        return { lastMove: { tick, description: "Noop" } };
      }
      if (rival.netWorth < move.downPaymentCents) {
        return {
          lastMove: {
            tick,
            description: `${rival.name} eyed ${prop.address} but lacked the down payment.`,
          },
        };
      }
      const loanId = nanoid(8);
      const creditScore = rivalCreditScore(rival.netWorth);
      const res = originateMortgage({
        id: loanId,
        propertyId: prop.id,
        purchasePriceCents: prop.listPriceCents,
        downPaymentCents: move.downPaymentCents,
        creditScore,
        macro: state.macro,
        tick,
      });
      if (!res.ok || !res.loan) {
        return {
          lastMove: {
            tick,
            description: `${rival.name} walked away from ${prop.address}: ${res.error ?? "bad terms"}.`,
          },
        };
      }
      const loan = res.loan;
      const nextProperties = {
        ...state.properties,
        [prop.id]: {
          ...prop,
          ownerId: rival.id,
          purchasePriceCents: prop.listPriceCents,
          purchaseTick: tick,
          listPriceCents: undefined,
          mortgageId: loan.balance > 0 ? loan.id : undefined,
        },
      };
      const nextMortgages = { ...state.mortgages };
      if (loan.balance > 0) {
        nextMortgages[loan.id] = loan;
      }
      const nextRivals: Record<string, AIRival> = {
        ...state.rivals,
        [rival.id]: {
          ...rival,
          netWorth: rival.netWorth - move.downPaymentCents,
        },
      };
      return {
        properties: nextProperties,
        mortgages: nextMortgages,
        rivals: nextRivals,
        lastMove: {
          tick,
          description: `${rival.name} bought ${prop.address} (${prop.class}-class).`,
        },
      };
    }
    case "no_op":
    default:
      return { lastMove: { tick, description: `${rival.name} held position.` } };
  }
}
