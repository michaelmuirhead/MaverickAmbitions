/**
 * v0.4 smoke: bar + restaurant + cafe in the same market.
 *
 *   1. newGame
 *   2. open a cafe + bar + restaurant in the richest market
 *   3. step 168 ticks (one in-game week)
 *   4. print: per-biz CSAT, tips paid, halo, profit
 *
 * The interesting property: halo should be higher than cafe-only
 * because bar + restaurant both contribute. Tips should show up as
 * ledger entries in `category: "tips"`.
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

let g = newGame({ seed: "smoke-hospitality-1", founderName: "Tester", difficulty: 3 });

// Fund enough for cafe ($75k) + bar ($125k) + restaurant ($200k) = $400k.
g = { ...g, player: { ...g.player, personalCash: 600_000_00 } };

const sorted = Object.values(g.markets).sort(
  (a, b) => b.desirability - a.desirability,
);
const target = sorted[0]!;
console.log(`Target market: ${target.name} (desirability ${(target.desirability * 100).toFixed(0)}%)`);

g = openOwned(g, "cafe", target.id, "Test Roast");
g = openOwned(g, "bar", target.id, "Test Tap Room");
g = openOwned(g, "restaurant", target.id, "Test Kitchen");

const playerId = g.player.id;
const cafeId = Object.values(g.businesses).find(
  (b) => b.type === "cafe" && b.ownerId === playerId,
)!.id;
const barId = Object.values(g.businesses).find(
  (b) => b.type === "bar" && b.ownerId === playerId,
)!.id;
const restaurantId = Object.values(g.businesses).find(
  (b) => b.type === "restaurant" && b.ownerId === playerId,
)!.id;

console.log(`\nInitial halo: ${(hospitalityHalo(g, playerId, target.id) * 100).toFixed(1)}%`);
console.log(`Initial cash: $${(g.player.personalCash / 100).toLocaleString()}`);

// Step one week (168 hours).
for (let i = 0; i < 168; i++) {
  g = stepTick(g);
}

const cafe = g.businesses[cafeId]!;
const bar = g.businesses[barId]!;
const rest = g.businesses[restaurantId]!;
const tipEntries = g.ledger.filter((e) => e.category === "tips");
const licenseEntries = g.ledger.filter((e) => e.category === "license_fee");

console.log(`\nAfter 1 week (tick ${g.clock.tick}):`);
for (const [label, biz] of [["Cafe", cafe], ["Bar", bar], ["Restaurant", rest]] as const) {
  console.log(`  ${label}: CSAT ${biz.kpis.customerSatisfaction.toFixed(1)}  rev $${(biz.kpis.weeklyRevenue / 100).toLocaleString()}  profit $${(biz.kpis.weeklyProfit / 100).toLocaleString()}`);
}
console.log(`  Halo for ${target.name}: ${(hospitalityHalo(g, playerId, target.id) * 100).toFixed(1)}%`);
console.log(`  Tip ledger entries: ${tipEntries.length}  total $${(tipEntries.reduce((a, e) => a + e.amount, 0) / 100).toLocaleString()}`);
console.log(`  License ledger entries: ${licenseEntries.length}  total $${(licenseEntries.reduce((a, e) => a + e.amount, 0) / 100).toLocaleString()}`);

// Step 3 more weeks to see flywheel + rival reactions.
for (let i = 0; i < 168 * 3; i++) {
  g = stepTick(g);
}
const cafe2 = g.businesses[cafeId]!;
const bar2 = g.businesses[barId]!;
const rest2 = g.businesses[restaurantId]!;
const tipEntries2 = g.ledger.filter((e) => e.category === "tips");
console.log(`\nAfter 4 weeks (tick ${g.clock.tick}):`);
for (const [label, biz] of [["Cafe", cafe2], ["Bar", bar2], ["Restaurant", rest2]] as const) {
  console.log(`  ${label}: CSAT ${biz.kpis.customerSatisfaction.toFixed(1)}  profit $${(biz.kpis.weeklyProfit / 100).toLocaleString()}`);
}
console.log(`  Halo: ${(hospitalityHalo(g, playerId, target.id) * 100).toFixed(1)}%`);
console.log(`  Tips paid (4w total): $${(tipEntries2.reduce((a, e) => a + e.amount, 0) / 100).toLocaleString()}`);
console.log(`  Rivals that opened hospitality:`);
for (const r of Object.values(g.rivals)) {
  const hospBizes = r.businessIds
    .map((id) => g.businesses[id])
    .filter((b): b is Business => !!b && (b.type === "bar" || b.type === "restaurant"));
  if (hospBizes.length > 0) {
    console.log(`    ${r.name} [${r.personality}] — ${hospBizes.map((b) => `${b.type}:${b.name}`).join(", ")}`);
  }
}
console.log(`  Player cash: $${(g.player.personalCash / 100).toLocaleString()}`);
console.log(`\nOK`);
