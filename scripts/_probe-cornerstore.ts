/**
 * Scratch sim (v0.10 balance probe): open a corner store at D3 in the
 * default market set, run it 6 weeks with default levers, and print
 * per-week revenue, COGS, wages, rent, marketing, tax, cash delta, and
 * net profit.
 *
 * Purpose: understand why week-1 cashflow is negative and where the
 * bleed is concentrated so we can propose targeted balance fixes.
 */

import { newGame, stepTick, getBusinessModule } from "../src/engine";
import { nanoid } from "nanoid";
import type {
  GameState,
  Business,
  LedgerEntry,
} from "../src/types/game";

function openStore(state: GameState, marketId: string, name: string): GameState {
  const mod = getBusinessModule("corner_store");
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
    player: {
      ...state.player,
      personalCash: state.player.personalCash - cost,
    },
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

function sumByBucket(
  ledger: LedgerEntry[],
  bizId: string,
  tickLo: number,
  tickHi: number,
  kinds: string[],
): number {
  let total = 0;
  for (const e of ledger) {
    if (e.businessId !== bizId) continue;
    if (e.tick < tickLo || e.tick >= tickHi) continue;
    if (!kinds.includes(e.category)) continue;
    total += e.amount;
  }
  return total;
}

function $ (cents: number): string {
  const sign = cents < 0 ? "-" : " ";
  const abs = Math.abs(cents) / 100;
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function runSim(label: string, sortBy: "desirability" | "desc") {
  let g = newGame({ seed: "balance-probe-" + label, founderName: "Tester", difficulty: 3 });
  g = { ...g, player: { ...g.player, personalCash: 200_000_00 } };

  const markets = Object.values(g.markets).sort(
    (a, b) => (sortBy === "desirability" ? b.desirability - a.desirability : a.desirability - b.desirability),
  );
  const target = markets[0]!;
  console.log(`\n=== ${label}: ${target.name} (desirability ${(target.desirability * 100).toFixed(0)}%) ===`);

  g = openStore(g, target.id, `Probe Store ${label}`);
  const storeId = Object.values(g.businesses).find(
    (b) => b.type === "corner_store" && b.ownerId === g.player.id,
  )!.id;

  const weeks = 6;
  console.log(
    `wk │  rev     │  cogs    │  wages   │  rent   │ mkt  │  tax   │  profit  │  cash    │ csat`,
  );
  for (let w = 0; w < weeks; w++) {
    const tickStart = g.clock.tick;
    for (let i = 0; i < 168; i++) g = stepTick(g);
    const tickEnd = g.clock.tick;

    const store = g.businesses[storeId]!;
    const rev = sumByBucket(g.ledger, storeId, tickStart, tickEnd, ["revenue"]);
    // P&L COGS only — inventory_purchase is a cash outflow for stock on
    // hand, not an income-statement expense. Summing both double-counted.
    const cogsTotal = -sumByBucket(g.ledger, storeId, tickStart, tickEnd, ["cogs"]);
    const wages = -sumByBucket(g.ledger, storeId, tickStart, tickEnd, ["wages"]);
    const rent = -sumByBucket(g.ledger, storeId, tickStart, tickEnd, ["rent"]);
    const mkt = -sumByBucket(g.ledger, storeId, tickStart, tickEnd, ["marketing"]);
    const tax = -sumByBucket(g.ledger, storeId, tickStart, tickEnd, ["tax"]);
    const profit = rev - cogsTotal - wages - rent - mkt - tax;
    console.log(
      `${String(w + 1).padStart(2, " ")} │ ${$(rev).padStart(9)} │ ${$(-cogsTotal).padStart(9)} │ ${$(-wages).padStart(9)} │ ${$(-rent).padStart(8)} │ ${$(-mkt).padStart(5)} │ ${$(-tax).padStart(7)} │ ${$(profit).padStart(9)} │ ${$(store.cash).padStart(9)} │ ${store.kpis.customerSatisfaction.toFixed(0)}`,
    );
  }
}

runSim("richest market", "desirability");
runSim("poorest market", "desc");
