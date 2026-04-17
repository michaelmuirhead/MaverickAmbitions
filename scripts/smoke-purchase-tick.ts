/**
 * v0.6 smoke: purchase → tick → revenue loop.
 *
 * The canary for the bug Michael hit on live (clock freezes after buying
 * a corner store). Proves three things at once:
 *
 *   1. stepTick is *pure* — passing a deep-frozen GameState through it
 *      does not throw, which means no business tick module mutates its
 *      frozen input. If autoFreeze regression creeps back, this fails.
 *   2. tick advances monotonically after a purchase.
 *   3. A live corner store actually generates revenue during business
 *      hours (proving onHour ran end-to-end, not just swallowed errors).
 *
 * Run with:  npx tsx scripts/smoke-purchase-tick.ts
 */

import { newGame, stepTick, getBusinessModule } from "../src/engine";
import type { Business, GameState } from "../src/types/game";

let failures = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? `  [${detail}]` : ""}`);
  }
}

/**
 * Recursively freeze an object tree. Matches what immer does to state
 * returned by a Zustand store once autoFreeze is on (the default).
 * If any engine code tries to mutate a frozen property, Node throws a
 * TypeError in strict mode (which ESM modules are by default).
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

console.log("==== v0.6 purchase → tick → revenue smoke ====\n");

// ---------- Part 1: stepTick is pure on a frozen input ----------

console.log("-- stepTick purity (frozen input) --");
{
  const g0 = deepFreeze(
    newGame({ seed: "smoke-buy-tick-pure", founderName: "Tester", difficulty: 3 }),
  );
  let state: GameState = g0;
  let threw = false;
  try {
    for (let i = 0; i < 10; i++) {
      state = deepFreeze(stepTick(state));
    }
  } catch (err) {
    threw = true;
    console.log(`    thrown: ${(err as Error).message}`);
  }
  check("10 ticks on frozen state do not throw", !threw);
  check("tick advanced to 10", state.clock.tick === 10);
  check("input state is preserved (clock.tick still 0)", g0.clock.tick === 0);
}

// ---------- Part 2: purchase a corner store, run 2 in-game days ----------

console.log("\n-- purchase corner store, run 2 in-game days (48 ticks) --");
{
  const g0 = newGame({
    seed: "smoke-buy-tick-run",
    founderName: "Tester",
    difficulty: 3,
  });
  const mod = getBusinessModule("corner_store");
  const market = Object.values(g0.markets)[0]!;
  const bizId = "smoke-store-1";
  const biz: Business = mod.create({
    id: bizId,
    ownerId: g0.player.id,
    name: "Smoke Store",
    locationId: market.id,
    tick: g0.clock.tick,
    seed: g0.seed,
  });

  // Simulate the store.openBusiness mutation path without the store.
  const cashBefore = g0.player.personalCash;
  const startupCost = mod.startup.startupCostCents;
  const withBiz: GameState = {
    ...g0,
    player: { ...g0.player, personalCash: cashBefore - startupCost },
    businesses: { ...g0.businesses, [bizId]: biz },
    markets: {
      ...g0.markets,
      [market.id]: {
        ...market,
        businessIds: [...market.businessIds, bizId],
      },
    },
  };

  // Freeze everything on the way in — this is what Zustand's store does.
  let state: GameState = deepFreeze(withBiz);

  // Run 48 ticks = 2 in-game days. Spans multiple business-hour blocks
  // plus a daily boundary, so onHour and onDay both execute.
  let threw = false;
  try {
    for (let i = 0; i < 48; i++) {
      state = deepFreeze(stepTick(state));
    }
  } catch (err) {
    threw = true;
    console.log(`    thrown at tick ${state.clock.tick}: ${(err as Error).message}`);
  }

  check("48 ticks with an owned store do not throw", !threw);
  check("clock advanced to tick 48", state.clock.tick === 48);

  const storedBiz = state.businesses[bizId];
  check("store still present in businesses record", storedBiz !== undefined);

  if (storedBiz) {
    const bizState = storedBiz.state as Record<string, unknown>;
    const weeklyRev = Number(bizState.weeklyRevenueAcc ?? 0);
    const wages = Number(bizState.wagesAccrued ?? 0);
    console.log(
      `    after 48 ticks: weeklyRevenueAcc=${weeklyRev}, wagesAccrued=${wages}`,
    );
    check(
      "wages accrued over 48 business-hour windows (proves onHour mutations persisted)",
      wages > 0,
    );
    // Revenue is stochastic — during off-hours it's zero, during peak hours
    // usually positive. Over 48 ticks we should see at least some revenue.
    check("at least some weekly revenue accumulated", weeklyRev > 0);

    // Ledger: we want to see revenue entries tied to this business.
    const bizLedger = state.ledger.filter((l) => l.businessId === bizId);
    const revEntries = bizLedger.filter((l) => l.category === "revenue");
    console.log(
      `    ledger: ${bizLedger.length} biz entries, ${revEntries.length} revenue entries`,
    );
    check("ledger contains revenue entries for this store", revEntries.length > 0);
  }
}

// ---------- Part 3: original input reference is untouched ----------
//
// Strong test: call stepTick with a fresh state, capture its businesses
// reference before and after. After stepTick returns, the reference on
// the input must still be the original, and its inner `state` object
// must still equal its pre-call snapshot. Regression check: confirms
// that the module clones (and doesn't mutate in place).

console.log("\n-- stepTick does not mutate the input state ref --");
{
  const g0 = newGame({
    seed: "smoke-buy-tick-immutable",
    founderName: "Tester",
    difficulty: 3,
  });
  const mod = getBusinessModule("corner_store");
  const market = Object.values(g0.markets)[0]!;
  const biz: Business = mod.create({
    id: "imm-store",
    ownerId: g0.player.id,
    name: "Immutability Check",
    locationId: market.id,
    tick: g0.clock.tick,
    seed: g0.seed,
  });
  const withBiz: GameState = {
    ...g0,
    businesses: { [biz.id]: biz },
  };

  const bizStateSnapshot = JSON.stringify(biz.state);
  const _after = stepTick(withBiz);
  void _after;
  check(
    "input business.state is byte-identical after stepTick",
    JSON.stringify(biz.state) === bizStateSnapshot,
  );
  check(
    "input businesses record is the same reference",
    withBiz.businesses[biz.id] === biz,
  );
}

// ---------- Summary ----------
console.log(`\n==== Summary: ${failures === 0 ? "PASS" : `${failures} FAILURE(S)`} ====`);
if (failures > 0) process.exit(1);
