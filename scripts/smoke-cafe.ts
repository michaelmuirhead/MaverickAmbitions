/**
 * Headless vertical-slice smoke test:
 *   1. newGame
 *   2. open a cafe in the richest market
 *   3. open a corner store in the same market
 *   4. step 168 ticks (one in-game week)
 *   5. print: CSAT, halo on corner store, weekly profit
 */

import { newGame, stepTick, getBusinessModule } from "../src/engine";
import { hospitalityHalo } from "../src/engine/economy/reputation";
import { nanoid } from "nanoid";
import type { GameState, BusinessTypeId, Business } from "../src/types/game";

function openOwned(
  state: GameState,
  type: BusinessTypeId,
  marketId: string,
  name: string,
): GameState {
  const mod = getBusinessModule(type);
  const id = nanoid(8);
  const biz: Business = mod.create({
    id,
    ownerId: state.player.id,
    name,
    locationId: marketId,
    tick: state.clock.tick,
    seed: state.seed,
  });
  const cost = mod.startup.startupCostCents;
  return {
    ...state,
    player: { ...state.player, personalCash: state.player.personalCash - cost },
    businesses: { ...state.businesses, [id]: biz },
    markets: {
      ...state.markets,
      [marketId]: {
        ...state.markets[marketId]!,
        businessIds: [...state.markets[marketId]!.businessIds, id],
      },
    },
  };
}

let g = newGame({ seed: "smoke-1", founderName: "Tester", difficulty: 3 });

// Fudge personal cash so we can afford a cafe ($75k) + corner store ($35k).
g = { ...g, player: { ...g.player, personalCash: 200_000_00 } };

const sorted = Object.values(g.markets).sort(
  (a, b) => b.desirability - a.desirability,
);
const target = sorted[0]!;
console.log(`Target market: ${target.name} (desirability ${(target.desirability * 100).toFixed(0)}%)`);

g = openOwned(g, "cafe", target.id, "Test Roast");
g = openOwned(g, "corner_store", target.id, "Test Corner");

const playerId = g.player.id;
const cafeId = Object.values(g.businesses).find(
  (b) => b.type === "cafe" && b.ownerId === playerId,
)!.id;
const storeId = Object.values(g.businesses).find(
  (b) => b.type === "corner_store" && b.ownerId === playerId,
)!.id;

console.log(`\nInitial halo: ${(hospitalityHalo(g, playerId, target.id) * 100).toFixed(1)}%`);
console.log(`Initial cash: $${(g.player.personalCash / 100).toLocaleString()}`);

// Step one week (168 hours).
for (let i = 0; i < 168; i++) {
  g = stepTick(g);
}

const cafe = g.businesses[cafeId]!;
const store = g.businesses[storeId]!;
console.log(`\nAfter 1 week (tick ${g.clock.tick}):`);
console.log(`  Cafe CSAT: ${cafe.kpis.customerSatisfaction.toFixed(1)}`);
console.log(`  Cafe weekly revenue: $${(cafe.kpis.weeklyRevenue / 100).toLocaleString()}`);
console.log(`  Cafe weekly profit: $${(cafe.kpis.weeklyProfit / 100).toLocaleString()}`);
console.log(`  Store weekly revenue: $${(store.kpis.weeklyRevenue / 100).toLocaleString()}`);
console.log(`  Store weekly profit: $${(store.kpis.weeklyProfit / 100).toLocaleString()}`);
console.log(`  Halo for ${target.name}: ${(hospitalityHalo(g, playerId, target.id) * 100).toFixed(1)}%`);
console.log(`  Rivals: ${Object.values(g.rivals).map(r => `${r.name} [${r.personality}] biz=${r.businessIds.length}`).join(", ")}`);

// Step 3 more weeks to see rival moves + CSAT flywheel effect.
for (let i = 0; i < 168 * 3; i++) {
  g = stepTick(g);
}
const cafe2 = g.businesses[cafeId]!;
const store2 = g.businesses[storeId]!;
console.log(`\nAfter 4 weeks (tick ${g.clock.tick}):`);
console.log(`  Cafe CSAT: ${cafe2.kpis.customerSatisfaction.toFixed(1)}`);
console.log(`  Cafe weekly profit: $${(cafe2.kpis.weeklyProfit / 100).toLocaleString()}`);
console.log(`  Store weekly profit: $${(store2.kpis.weeklyProfit / 100).toLocaleString()}`);
console.log(`  Halo: ${(hospitalityHalo(g, playerId, target.id) * 100).toFixed(1)}%`);
console.log(`  Rivals:`);
for (const r of Object.values(g.rivals)) {
  console.log(`    ${r.name} [${r.personality}] businesses=${r.businessIds.length} last=${r.lastMove?.description ?? "—"}`);
}
console.log(`  Player cash: $${(g.player.personalCash / 100).toLocaleString()}`);
console.log(`\nOK`);
