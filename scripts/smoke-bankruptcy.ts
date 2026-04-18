/**
 * Headless v0.9 "Failure & Flow" regression smoke test.
 *
 * Exercises the full bankruptcy cascade end-to-end by stepping the
 * engine tick, with no store, no UI, and no real-world time. The goal
 * is to catch regressions in the failure pipeline — each hop is a
 * separate module (insolvency → liquidation → personal bankruptcy →
 * succession) and the only way they're glued together is through
 * `stepTick`, so we test them through `stepTick`.
 *
 *   [1] Rig an already-distressed corner store with a fat business
 *       loan so the collapse has real unsecured debt to feed into
 *       personal.
 *   [2] One weekly tick: status should transition to `distressed` and
 *       `insolvencyWeeks = 1`.
 *   [3] Four weekly ticks: business is liquidated. Record is gone
 *       from `game.businesses`, a `ClosedBusinessRecord` is present
 *       on `player.closedBusinesses`, the business loan is wiped,
 *       and `player.personalUnsecuredDebtCents > 0` (collapsed from
 *       the loan).
 *   [4] Keep ticking until personal bankruptcy fires. After filing:
 *       credit floor = 300, `bankruptcyFlag` present, history entry
 *       added, unsecured debt discharged (back to 0).
 *   [5] `applySuccession` runs at end-of-tick after `alive = false`.
 *       In a fresh founder game there is no adult heir, so we expect
 *       `player.alive === false` with `deathTick` set — the terminal
 *       state the UI renders as game-over.
 */
import { nanoid } from "nanoid";

import { newGame, stepTick, getBusinessModule } from "../src/engine";
import {
  maxLoanToCost,
  originateBusinessLoan,
} from "../src/engine/economy/businessLoan";
import {
  INSOLVENCY_DISTRESS_THRESHOLD_CENTS,
  INSOLVENCY_WEEKS_TO_LIQUIDATION,
} from "../src/engine/business/insolvency";
import type { Business, Cents, GameState } from "../src/types/game";

function fmt$(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

const HOURS_PER_DAY = 24;
const HOURS_PER_WEEK = HOURS_PER_DAY * 7;

function stepHours(state: GameState, hours: number): GameState {
  let s = state;
  for (let i = 0; i < hours; i++) s = stepTick(s);
  return s;
}

// ============================================================
// [1] Build a rigged game: distressed corner store + big loan.
// ============================================================
let g: GameState = newGame({
  seed: "bankruptcy-smoke",
  founderName: "Doomed",
  difficulty: 3,
});

const bizId = nanoid(8);
const market = Object.values(g.markets)[0]!;
const cornerMod = getBusinessModule("corner_store");
const biz: Business = cornerMod.create({
  id: bizId,
  ownerId: g.player.id,
  name: "Sinking Corner",
  locationId: market.id,
  tick: g.clock.tick,
  seed: g.seed,
});

// Force cash well below the distress threshold so the state machine
// engages on the very first weekly tick.
biz.cash = (INSOLVENCY_DISTRESS_THRESHOLD_CENTS - 1_000_00) as Cents;

// Fat loan to make collapse produce real unsecured debt.
const loanFace = 200_000_00;
const orig = originateBusinessLoan({
  id: nanoid(8),
  businessId: bizId,
  startupCostCents: loanFace,
  borrowCents: Math.floor(
    loanFace * maxLoanToCost(g.player.creditScore),
  ),
  creditScore: g.player.creditScore,
  macro: g.macro,
  tick: g.clock.tick,
});
if (!orig.ok || !orig.loan) {
  console.error("✗ Could not originate stress loan — setup broken");
  process.exit(1);
}
const loan = orig.loan;

g = {
  ...g,
  player: { ...g.player, personalCash: 0 as Cents, creditScore: 660 },
  businesses: { ...g.businesses, [biz.id]: biz },
  businessLoans: { ...g.businessLoans, [loan.id]: loan },
  markets: {
    ...g.markets,
    [market.id]: {
      ...market,
      businessIds: [...market.businessIds, biz.id],
    },
  },
};

console.log(`\n[1] Rigged setup`);
console.log(
  `  Biz cash ${fmt$(biz.cash)} · threshold ${fmt$(INSOLVENCY_DISTRESS_THRESHOLD_CENTS)} · loan balance ${fmt$(loan.balance)}`,
);
console.log(
  `  Player personal cash ${fmt$(g.player.personalCash)} · credit ${g.player.creditScore}`,
);
assert(
  biz.cash < INSOLVENCY_DISTRESS_THRESHOLD_CENTS,
  "Business starts below the distress threshold",
);
assert(loan.balance > 0, "Unsecured debt seed is in place");

// ============================================================
// [2] Advance one week. Expect status: distressed, weeks: 1.
// ============================================================
g = stepHours(g, HOURS_PER_WEEK);
const afterWeek1 = g.businesses[bizId];
assert(!!afterWeek1, "Business still open after 1 week");
console.log(`\n[2] After 1 week (tick ${g.clock.tick})`);
console.log(
  `  status=${afterWeek1!.status} · insolvencyWeeks=${afterWeek1!.insolvencyWeeks} · cash ${fmt$(afterWeek1!.cash)}`,
);
assert(
  afterWeek1!.status === "distressed",
  "Status transitions operating → distressed after 1 underwater week",
);
assert(
  (afterWeek1!.insolvencyWeeks ?? 0) === 1,
  "insolvencyWeeks = 1",
);

// ============================================================
// [3] Advance through the 4-week liquidation threshold.
//
// Because the rigged setup starts the player with $0 personal cash
// and no real estate, the 25% debt-service formula is insolvent from
// the instant the business loan collapses — so personal bankruptcy
// fires on the SAME tick as liquidation. We verify both transitions
// together rather than try to observe the intermediate state.
// ============================================================
// Tick week-by-week so we can record the precise week liquidation
// happens (handy when this smoke fails after an engine change).
let liquidatedAtWeek = -1;
for (let w = 2; w <= INSOLVENCY_WEEKS_TO_LIQUIDATION + 2; w++) {
  g = stepHours(g, HOURS_PER_WEEK);
  if (!(bizId in g.businesses)) {
    liquidatedAtWeek = w;
    break;
  }
}

const closedRecord = g.player.closedBusinesses[bizId];
console.log(
  `\n[3] After ${liquidatedAtWeek} total weeks (tick ${g.clock.tick})`,
);
console.log(
  `  Business record present? ${bizId in g.businesses} · postmortem present? ${!!closedRecord}`,
);
console.log(
  `  Business loans tracked: ${Object.keys(g.businessLoans).length}`,
);
console.log(
  `  Live personal unsecured debt ${fmt$(g.player.personalUnsecuredDebtCents)} · postmortem shows collapsed debt ${fmt$(closedRecord?.unsecuredDebtFromLoanCents ?? 0)}`,
);
assert(
  liquidatedAtWeek > 1 &&
    liquidatedAtWeek <= INSOLVENCY_WEEKS_TO_LIQUIDATION + 2,
  `Business liquidated within the 4-week window (actually at week ${liquidatedAtWeek})`,
);
assert(
  !(bizId in g.businesses),
  "Business record removed from game.businesses after liquidation",
);
assert(
  !!closedRecord && closedRecord.closedReason === "liquidation",
  "ClosedBusinessRecord stored with reason=liquidation",
);
assert(
  closedRecord!.unsecuredDebtFromLoanCents > 0,
  "Liquidation collapsed loan balance into unsecured debt on the postmortem",
);
assert(
  !(loan.id in g.businessLoans),
  "Collapsed business loan record removed from game.businessLoans",
);

// ============================================================
// [4] Personal bankruptcy filing — either fired this tick or within
//     a few more weeks. Give the engine 12 weeks of runway to reach
//     the trigger, then verify the aftermath.
// ============================================================
if (!g.player.bankruptcyFlag) {
  for (let w = 0; w < 12 && !g.player.bankruptcyFlag; w++) {
    g = stepHours(g, HOURS_PER_WEEK);
  }
}

console.log(`\n[4] Personal bankruptcy filing`);
console.log(
  `  bankruptcyFlag? ${!!g.player.bankruptcyFlag} · credit ${g.player.creditScore} · alive ${g.player.alive}`,
);
console.log(
  `  Remaining unsecured debt ${fmt$(g.player.personalUnsecuredDebtCents)} · history entries ${g.player.bankruptcyHistory.length}`,
);
assert(!!g.player.bankruptcyFlag, "Personal bankruptcy flag is set");
assert(g.player.creditScore === 300, "Credit score dropped to floor (300)");
assert(
  g.player.bankruptcyHistory.length >= 1,
  "Bankruptcy history entry recorded for dynasty tracking",
);
assert(
  g.player.personalUnsecuredDebtCents === 0,
  "Remaining unsecured debt discharged in Chapter 7",
);
assert(
  g.player.bankruptcyFlag!.expiresAtTick >
    g.player.bankruptcyFlag!.filedAtTick,
  "Bankruptcy flag has a valid 7-year lockout expiry window",
);

// ============================================================
// [5] Terminal state — alive=false drives succession; no heir in a
//     fresh founder game, so the game enters game-over.
// ============================================================
console.log(`\n[5] Succession / terminal state`);
console.log(
  `  player.alive=${g.player.alive} · deathTick=${g.player.deathTick ?? "<unset>"} · generation=${g.player.generation}`,
);
assert(!g.player.alive, "Player marked !alive (succession handoff)");
assert(
  typeof g.player.deathTick === "number",
  "deathTick recorded on terminal state",
);

console.log(`\nOK`);
