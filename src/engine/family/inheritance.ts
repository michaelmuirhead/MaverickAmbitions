/**
 * Succession & inheritance. Invoked when the player retires or dies.
 *
 * The MVP keeps inheritance-tax simple and defaults heir selection to
 * the eldest child. A later version adds wills, trusts, and rival
 * contests.
 */

import type {
  Business,
  Cents,
  FamilyMember,
  GameState,
  PlayerCharacter,
} from "@/types/game";

import { dollars } from "@/lib/money";
import type { RNG } from "@/lib/rng";

import { createFounder, defaultNeeds, defaultSkills } from "../player/character";

/** Estate tax applied to cash + liquid assets transferred at death. */
export const ESTATE_TAX_EXEMPT_CENTS = dollars(10_000_000);
export const ESTATE_TAX_RATE_OVER_EXEMPT = 0.4;

export function estateTax(netWorthCents: Cents): Cents {
  const taxable = Math.max(0, netWorthCents - ESTATE_TAX_EXEMPT_CENTS);
  return Math.round(taxable * ESTATE_TAX_RATE_OVER_EXEMPT);
}

export function chooseHeir(
  player: PlayerCharacter,
  family: Record<string, FamilyMember>,
): FamilyMember | undefined {
  const candidates = player.childrenIds
    .map((id) => family[id])
    .filter((m): m is FamilyMember => !!m && m.alive && m.age >= 18);
  if (candidates.length === 0) return undefined;
  // Default: oldest with highest management trait.
  return [...candidates].sort((a, b) => {
    const dAge = b.age - a.age;
    if (dAge !== 0) return dAge;
    return (b.traits.management ?? 0) - (a.traits.management ?? 0);
  })[0];
}

export function promoteToPlayer(
  heir: FamilyMember,
  previous: PlayerCharacter,
  rng: RNG,
  tick: number,
): PlayerCharacter {
  const base = createFounder({ name: heir.name, rng, tick });
  return {
    ...base,
    generation: previous.generation + 1,
    skills: {
      ...defaultSkills(),
      management: Math.max(defaultSkills().management, heir.traits.management ?? 0),
      charisma: Math.max(defaultSkills().charisma, heir.traits.charisma ?? 0),
    },
    needs: defaultNeeds(),
    age: heir.age,
    parentIds: [previous.id],
    reputation: Math.round(previous.reputation * 0.5),
  };
}

/** Compute total inheritable cash: personal + business cash (post-tax). */
export function liquidEstate(
  player: PlayerCharacter,
  businesses: Record<string, Business>,
): Cents {
  const playerBiz = Object.values(businesses).filter(
    (b) => b.ownerId === player.id,
  );
  const bizCash = playerBiz.reduce((acc, b) => acc + b.cash, 0);
  return player.personalCash + bizCash;
}

/** Apply the whole succession transaction to game state (returns new state). */
export function applySuccession(
  state: GameState,
  rng: RNG,
): { state: GameState; heirName?: string } {
  const heir = chooseHeir(state.player, state.family);
  if (!heir) {
    // Game over for this lineage.
    return {
      state: {
        ...state,
        player: { ...state.player, alive: false, deathTick: state.clock.tick },
      },
    };
  }
  const estate = liquidEstate(state.player, state.businesses);
  const tax = estateTax(estate);
  const netEstate = Math.max(0, estate - tax);

  const newHead = promoteToPlayer(heir, state.player, rng, state.clock.tick);
  const withCash: PlayerCharacter = { ...newHead, personalCash: netEstate };

  // Transfer business ownership.
  const businesses: Record<string, Business> = { ...state.businesses };
  for (const biz of Object.values(businesses)) {
    if (biz.ownerId === state.player.id) {
      businesses[biz.id] = { ...biz, ownerId: withCash.id };
    }
  }

  // Remove previous player from family (they still exist for dynasty tree).
  const previous = { ...state.player, alive: false, deathTick: state.clock.tick };

  return {
    state: {
      ...state,
      player: withCash,
      businesses,
      family: {
        ...state.family,
        [previous.id]: {
          id: previous.id,
          name: previous.name,
          age: previous.age,
          role: "parent",
          traits: {
            management: previous.skills.management,
            charisma: previous.skills.charisma,
            finance: previous.skills.finance,
          },
          affinity: 0,
          alive: false,
        },
      },
      dynasty: {
        ...state.dynasty,
        generations: state.dynasty.generations + 1,
        cumulativeNetWorth: state.dynasty.cumulativeNetWorth + estate,
      },
    },
    heirName: heir.name,
  };
}
