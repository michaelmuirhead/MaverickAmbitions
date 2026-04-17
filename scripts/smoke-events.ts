/**
 * v0.5 smoke: macro shocks.
 *
 * Strategy:
 *   1. newGame, deterministic seed
 *   2. for each macro event in the catalog, force-activate it on a fresh
 *      state and verify that `applyMacroPulses` + `getPulseBundle` reflect
 *      the expected delta, and that `getEventBanners` surfaces a banner.
 *   3. Also run 1 in-game year (8760 ticks) on a natural seed and report:
 *      - how many events fired organically
 *      - whether activeEvents ever exceeded MAX_SIMULTANEOUS_EVENTS (should be no)
 *      - per-personality rival bias summary for one synthesized active event.
 *
 * Run with:  npx tsx scripts/smoke-events.ts
 */

import { newGame, stepTick, getBusinessModule } from "../src/engine";
import { MACRO_EVENTS } from "../src/data/macroEvents";
import {
  applyMacroPulses,
  expireFinishedEvents,
  forceActivate,
  getEventBanners,
  getPulseBundle,
} from "../src/engine/macro/events";
import { getRivalEventBias, hasReaction } from "../src/engine/ai/rivalReactions";
import { createRng } from "../src/lib/rng";
import type {
  Business,
  GameState,
  LedgerEntry,
  MacroEventId,
  RivalPersonality,
} from "../src/types/game";

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

let failures = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? `  [${detail}]` : ""}`);
  }
}

console.log("==== v0.5 macro shocks smoke ====\n");

// ---------- Part 1: per-event force-activate + pulse verification ----------

console.log("-- per-event pulse verification --");
for (const def of MACRO_EVENTS) {
  console.log(`\n[${def.id}] ${def.title} (${def.severity}/${def.tone})`);
  const g0 = newGame({ seed: "smoke-events-per-event", founderName: "Tester", difficulty: 3 });
  const { active } = forceActivate(g0, def.id, g0.clock.tick);
  const state: GameState = {
    ...g0,
    activeEvents: [active],
  };

  const pulsedMacro = applyMacroPulses(g0.macro, state.activeEvents);
  const bundle = getPulseBundle(state.activeEvents);
  const banners = getEventBanners(state, state.clock.tick);

  if (def.pulse.interestRateDelta !== undefined) {
    const expected = g0.macro.interestRate + def.pulse.interestRateDelta;
    const clamped = Math.min(0.2, Math.max(0.005, expected));
    check(
      `interestRate pulsed to ≈${(clamped * 100).toFixed(2)}%`,
      Math.abs(pulsedMacro.interestRate - clamped) < 1e-6,
      `got ${pulsedMacro.interestRate}`,
    );
  }
  if (def.pulse.consumerWalletMul !== undefined) {
    const expected = g0.macro.consumerWallet * def.pulse.consumerWalletMul;
    const clamped = Math.min(2.0, Math.max(0.5, expected));
    check(
      `consumerWallet pulsed (${fmtPct(def.pulse.consumerWalletMul - 1)})`,
      Math.abs(pulsedMacro.consumerWallet - clamped) < 1e-6,
    );
  }
  if (def.pulse.realEstateMul !== undefined) {
    const expected = g0.macro.realEstateMultiplier * def.pulse.realEstateMul;
    const clamped = Math.min(2.0, Math.max(0.5, expected));
    check(
      `realEstateMultiplier pulsed (${fmtPct(def.pulse.realEstateMul - 1)})`,
      Math.abs(pulsedMacro.realEstateMultiplier - clamped) < 1e-6,
    );
  }
  if (def.pulse.laborCostMul !== undefined) {
    const expected = g0.macro.laborCostMultiplier * def.pulse.laborCostMul;
    const clamped = Math.min(2.0, Math.max(0.5, expected));
    check(
      `laborCostMultiplier pulsed (${fmtPct(def.pulse.laborCostMul - 1)})`,
      Math.abs(pulsedMacro.laborCostMultiplier - clamped) < 1e-6,
    );
  }
  if (def.pulse.cogsMul !== undefined) {
    check(
      `pulse bundle cogsMultiplier = ${def.pulse.cogsMul}`,
      Math.abs(bundle.cogsMultiplier - def.pulse.cogsMul) < 1e-6,
    );
  }
  if (def.pulse.liquorLicenseFeeMul !== undefined) {
    check(
      `liquorLicenseFeeMultiplier = ${def.pulse.liquorLicenseFeeMul}`,
      Math.abs(bundle.liquorLicenseFeeMultiplier - def.pulse.liquorLicenseFeeMul) < 1e-6,
    );
  }
  if (def.pulse.trafficMulByType) {
    for (const [type, mul] of Object.entries(def.pulse.trafficMulByType)) {
      check(
        `trafficMulByType[${type}] = ${mul}`,
        Math.abs((bundle.trafficMultiplierByType[type as keyof typeof bundle.trafficMultiplierByType] ?? 1) - (mul ?? 1)) < 1e-6,
      );
    }
  }

  check(`banner present`, banners.length === 1 && banners[0]?.defId === def.id);
}

// ---------- Part 2: expireFinishedEvents ----------

console.log("\n\n-- expiry verification --");
{
  const g0 = newGame({ seed: "smoke-events-expiry", founderName: "Tester", difficulty: 3 });
  const def = MACRO_EVENTS[0]!;
  const { active } = forceActivate(g0, def.id, 0);
  const state: GameState = { ...g0, activeEvents: [active] };
  // Fast-forward: pretend we're already past endTick.
  const pastTick = active.endTick + 1;
  const result = expireFinishedEvents(state, pastTick);
  check("event expired out of activeEvents", result.activeEvents.length === 0);
  check("event appended to eventHistory", result.eventHistory.length === 1);
  check("expiry emits macro_shock_end GameEvent", result.gameEvents.some((e) => e.kind === "macro_shock_end"));
  check("expiry emits event_marker ledger entry", result.ledger.some((l) => l.category === "event_marker"));
}

// ---------- Part 3: organic year-long run ----------

console.log("\n\n-- year-long organic run (8760 ticks) --");
{
  let state = newGame({ seed: "smoke-events-year", founderName: "Tester", difficulty: 3 });
  let fired = 0;
  let maxSimultaneous = 0;
  for (let i = 0; i < 8760; i++) {
    state = stepTick(state);
    maxSimultaneous = Math.max(maxSimultaneous, state.activeEvents.length);
  }
  fired = state.eventHistory.length + state.activeEvents.length;
  console.log(`  events fired this year: ${fired}`);
  console.log(`  max simultaneous: ${maxSimultaneous}`);
  console.log(`  in eventHistory: ${state.eventHistory.length}`);
  console.log(`  still active at year end: ${state.activeEvents.length}`);
  check("at least 1 event fired in 52 weeks", fired >= 1);
  check("max simultaneous ≤ 3", maxSimultaneous <= 3);
}

// ---------- Part 4: rival reactions sanity ----------

console.log("\n\n-- rival reactions matrix (sample) --");
{
  const g0 = newGame({ seed: "smoke-events-rivals", founderName: "Tester", difficulty: 3 });
  const personalities: RivalPersonality[] = [
    "predator",
    "tycoon",
    "operator",
    "disruptor",
    "politician",
  ];
  const sampleDefs = ["recession_fears", "housing_downturn", "liquor_tax_hike", "viral_food_trend", "labor_scarcity"] as const;
  for (const defId of sampleDefs) {
    console.log(`\n  event: ${defId}`);
    for (const p of personalities) {
      const { active } = forceActivate(g0, defId, 0);
      const bias = getRivalEventBias(
        { id: "x", name: "Test", personality: p, difficulty: 3, netWorth: 1_000_000_00, businessIds: [], stance: 0 },
        [active],
      );
      const reacting = hasReaction(bias);
      const openMul = bias.openBusinessMultiplier.toFixed(2);
      const propBoost = bias.propertyBuyBoost;
      const priceBoost = bias.priceWarBoost;
      const hireBoost = bias.hireStaffBoost;
      const types = Object.entries(bias.typeUtilityMultiplier)
        .map(([t, m]) => `${t}=${m.toFixed(2)}`)
        .join(", ");
      console.log(
        `    ${p.padEnd(10)} react=${reacting ? "Y" : "N"}  open×${openMul} prop+${propBoost} price+${priceBoost} hire+${hireBoost}${types ? `  types:{${types}}` : ""}`,
      );
    }
  }
}

// ---------- Part 5: pulse bite — business modules feel the shocks ----------
//
// For each (module, event) pair we care about, spin up a fresh business,
// run a single `onHour` during business hours with no events, then again
// with the event force-activated, and confirm the ledger delta matches
// the pulse direction.

console.log("\n\n-- pulse bite: business modules feel the shocks --");
{
  // Tick 5 = Monday 13:00, well inside business hours for all modules.
  const BITE_TICK = 5;

  function sumCogs(ledger: LedgerEntry[]): number {
    return ledger
      .filter((l) => l.category === "cogs")
      .reduce((a, l) => a + l.amount, 0); // cogs are negative
  }
  function sumRevenue(ledger: LedgerEntry[]): number {
    return ledger
      .filter((l) => l.category === "revenue")
      .reduce((a, l) => a + l.amount, 0);
  }
  function sumLicense(ledger: LedgerEntry[]): number {
    return ledger
      .filter((l) => l.category === "license_fee")
      .reduce((a, l) => a + l.amount, 0); // license fees are negative
  }

  function runHour(
    moduleId: "corner_store" | "cafe" | "bar" | "restaurant",
    world: GameState,
    biz: Business,
    tick: number,
  ): { business: Business; ledger: LedgerEntry[] } {
    const mod = getBusinessModule(moduleId);
    const res = mod.onHour(biz, {
      tick,
      macro: world.macro,
      rng: createRng(`pulse-bite-${moduleId}-${tick}`),
      world,
    });
    return { business: res.business, ledger: res.ledger };
  }

  function seedWithBusiness(
    seed: string,
    moduleId: "corner_store" | "cafe" | "bar" | "restaurant",
    activeEventIds: MacroEventId[],
  ): { world: GameState; biz: Business } {
    const g0 = newGame({ seed, founderName: "Tester", difficulty: 3 });
    const mod = getBusinessModule(moduleId);
    const market = Object.values(g0.markets)[0]!;
    const biz = mod.create({
      id: `${moduleId}-smoke`,
      ownerId: g0.player.id,
      name: `Smoke ${moduleId}`,
      locationId: market.id,
      tick: 0,
      seed: `${seed}-biz`,
    });
    let active = g0.activeEvents;
    for (const id of activeEventIds) {
      const { active: e } = forceActivate(g0, id, 0);
      active = [...active, e];
    }
    const world: GameState = {
      ...g0,
      businesses: { [biz.id]: biz },
      activeEvents: active,
    };
    return { world, biz };
  }

  // corner_store: commodity_shortage bumps cogs ~12%.
  {
    const a = seedWithBusiness("bite-cs-off", "corner_store", []);
    const b = seedWithBusiness("bite-cs-off", "corner_store", ["commodity_shortage"]);
    const base = runHour("corner_store", a.world, a.biz, BITE_TICK);
    const shock = runHour("corner_store", b.world, b.biz, BITE_TICK);
    const baseCogs = -sumCogs(base.ledger);
    const shockCogs = -sumCogs(shock.ledger);
    const ratio = baseCogs > 0 ? shockCogs / baseCogs : 0;
    console.log(
      `  corner_store cogs: base=${baseCogs}, shock=${shockCogs}, ratio=${ratio.toFixed(3)}`,
    );
    check(
      "corner_store cogs scale ≈ 1.12 under commodity_shortage",
      baseCogs > 0 && ratio > 1.08 && ratio < 1.16,
    );
    // Revenue should be unchanged (same RNG, no traffic pulse on corner_store).
    check(
      "corner_store revenue unchanged under commodity_shortage",
      sumRevenue(base.ledger) === sumRevenue(shock.ledger),
    );
  }

  // cafe: commodity_shortage bumps cogs.
  {
    const a = seedWithBusiness("bite-cafe-off", "cafe", []);
    const b = seedWithBusiness("bite-cafe-off", "cafe", ["commodity_shortage"]);
    const base = runHour("cafe", a.world, a.biz, BITE_TICK);
    const shock = runHour("cafe", b.world, b.biz, BITE_TICK);
    const baseCogs = -sumCogs(base.ledger);
    const shockCogs = -sumCogs(shock.ledger);
    const ratio = baseCogs > 0 ? shockCogs / baseCogs : 0;
    console.log(
      `  cafe cogs:         base=${baseCogs}, shock=${shockCogs}, ratio=${ratio.toFixed(3)}`,
    );
    check(
      "cafe cogs scale ≈ 1.12 under commodity_shortage",
      baseCogs > 0 && ratio > 1.08 && ratio < 1.16,
    );
  }

  // restaurant: viral_food_trend lifts traffic (and therefore revenue).
  // Use the afternoon lull (tick 6 = 14:00, peak 0.5) so walk-in demand
  // is well below seat capacity — otherwise the +20% traffic boost is
  // absorbed by capacityThisHour and the bite is invisible.
  {
    const a = seedWithBusiness("bite-rest-off", "restaurant", []);
    const b = seedWithBusiness("bite-rest-off", "restaurant", ["viral_food_trend"]);
    const LULL_TICK = 6;
    const base = runHour("restaurant", a.world, a.biz, LULL_TICK);
    const shock = runHour("restaurant", b.world, b.biz, LULL_TICK);
    const baseRev = sumRevenue(base.ledger);
    const shockRev = sumRevenue(shock.ledger);
    const ratio = baseRev > 0 ? shockRev / baseRev : 0;
    console.log(
      `  restaurant rev:    base=${baseRev}, shock=${shockRev}, ratio=${ratio.toFixed(3)} (viral_food_trend @ lull)`,
    );
    check(
      "restaurant revenue increases under viral_food_trend",
      shockRev > baseRev,
    );
  }

  // bar + restaurant: liquor_tax_hike on a weekly tick with 4+ weeks
  // accrued must scale the license fee by 1.5×. We model that by nudging
  // `ticksSinceLicenseCharge` so onWeek will bill this cycle.
  {
    for (const moduleId of ["bar", "restaurant"] as const) {
      const seed = `bite-lic-${moduleId}`;
      const fresh = seedWithBusiness(seed, moduleId, []);
      const state = (fresh.biz.state as unknown) as { ticksSinceLicenseCharge: number };
      state.ticksSinceLicenseCharge = 4;
      const bizForShock = {
        ...fresh.biz,
        state: fresh.biz.state,
      } as Business;
      const bizForBase = {
        ...fresh.biz,
        state: { ...(fresh.biz.state as object), ticksSinceLicenseCharge: 4 } as Record<
          string,
          unknown
        >,
      } as Business;

      const mod = getBusinessModule(moduleId);
      const weekTick = 24 * 7; // first weekly boundary
      const worldA = fresh.world;
      const { active: hike } = forceActivate(fresh.world, "liquor_tax_hike", 0);
      const worldB: GameState = { ...fresh.world, activeEvents: [hike] };

      const baseWeek = mod.onWeek(bizForBase, {
        tick: weekTick,
        macro: worldA.macro,
        rng: createRng(`pulse-bite-${moduleId}-week`),
        world: worldA,
      });
      const shockWeek = mod.onWeek(bizForShock, {
        tick: weekTick,
        macro: worldB.macro,
        rng: createRng(`pulse-bite-${moduleId}-week`),
        world: worldB,
      });
      const baseFee = -sumLicense(baseWeek.ledger);
      const shockFee = -sumLicense(shockWeek.ledger);
      const ratio = baseFee > 0 ? shockFee / baseFee : 0;
      console.log(
        `  ${moduleId.padEnd(11)} license: base=${baseFee}, shock=${shockFee}, ratio=${ratio.toFixed(3)}`,
      );
      check(
        `${moduleId} license fee scales ≈ 1.5× under liquor_tax_hike`,
        baseFee > 0 && ratio > 1.45 && ratio < 1.55,
      );
    }
  }
}

// ---------- Summary ----------
console.log(`\n==== Summary: ${failures === 0 ? "PASS" : `${failures} FAILURE(S)`} ====`);
if (failures > 0) process.exit(1);
