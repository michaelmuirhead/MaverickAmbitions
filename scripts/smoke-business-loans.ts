/**
 * Headless v0.5.1 "Small-business credit" smoke test:
 *   1. newGame — verify player starts with ~$15K (can't afford $35K corner store cash)
 *   2. Verify the credit math: at 660 credit, maxLTC = 70%, minDown = $10.5K,
 *      so the player CAN finance a corner store with $24.5K loan.
 *   3. Originate the loan through the engine (no store wiring needed here) and
 *      splice it into the world the way the store would.
 *   4. Step one month — verify monthly payment drew from business cash first,
 *      balance amortized, credit nudged +1, ledger has interest+principal entries.
 *   5. Step 12 months — verify amortization progresses, no missed payments
 *      (corner store generates enough revenue to service the loan).
 *   6. Verify selectNetWorth subtracts outstanding business-loan principal.
 *   7. Stress test: simulate an expensive loan on a starved business, confirm
 *      the missed-payment path dings credit by 35.
 */

import { nanoid } from "nanoid";

import { newGame, stepTick, getBusinessModule } from "../src/engine";
import {
  BUSINESS_LOAN_MIN_CREDIT,
  businessLoanRate,
  maxLoanToCost,
  originateBusinessLoan,
  playerBusinessLoanDebt,
} from "../src/engine/economy/businessLoan";
import type { Business, GameState } from "../src/types/game";

// Mirror of selectNetWorth — we avoid importing the "use client" selectors
// file from a Node script.
function computeNetWorth(state: GameState): number {
  const personal = state.player.personalCash;
  const bizCash = Object.values(state.businesses)
    .filter((b) => b.ownerId === state.player.id)
    .reduce((acc, b) => acc + b.cash, 0);
  let reEquity = 0;
  for (const p of Object.values(state.properties)) {
    if (p.ownerId !== state.player.id) continue;
    const mb = p.mortgageId ? (state.mortgages[p.mortgageId]?.balance ?? 0) : 0;
    reEquity += p.valueCents - mb;
  }
  return personal + bizCash + reEquity - playerBusinessLoanDebt(state);
}

function fmt$(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

// 1. Fresh game.
let g: GameState = newGame({
  seed: "bloan-smoke-1",
  founderName: "Tester",
  difficulty: 3,
});

console.log(`\n[1] New game`);
console.log(
  `  Starting cash: ${fmt$(g.player.personalCash)} · credit ${g.player.creditScore}`,
);
assert(
  g.player.personalCash < 35_000_00,
  "Player cannot afford a $35K corner store from cash alone",
);

// 2. Credit math.
const score = g.player.creditScore;
const ltc = maxLoanToCost(score);
const cornerCost = 35_000_00;
const maxBorrow = Math.floor(cornerCost * ltc);
const minDown = cornerCost - maxBorrow;
const rate = businessLoanRate(g.macro, score);

console.log(`\n[2] Credit math for corner store @ credit ${score}`);
console.log(
  `  maxLTC=${(ltc * 100).toFixed(0)}% · maxBorrow=${fmt$(maxBorrow)} · minDown=${fmt$(minDown)} · rate=${(rate * 100).toFixed(2)}%`,
);
assert(score >= BUSINESS_LOAN_MIN_CREDIT, "Credit score ≥ 580 (loan-eligible)");
assert(ltc > 0, "Positive max LTC");
assert(g.player.personalCash >= minDown, "Player can afford the minimum down payment");

// 3. Originate + splice — mirror what the store does.
const bizId = nanoid(8);
const cornerMod = getBusinessModule("corner_store");
const orig = originateBusinessLoan({
  id: nanoid(8),
  businessId: bizId,
  startupCostCents: cornerCost,
  borrowCents: maxBorrow,
  creditScore: score,
  macro: g.macro,
  tick: g.clock.tick,
});
assert(orig.ok && !!orig.loan, "Loan origination OK");
const loan = orig.loan!;
console.log(`\n[3] Loan originated`);
console.log(
  `  Principal ${fmt$(loan.principal)} · rate ${(loan.annualRate * 100).toFixed(2)}% · term ${loan.termMonths}mo · payment ${fmt$(loan.monthlyPayment)}/mo`,
);

// Build the corner store with loan proceeds stacked on biz.cash.
const market = Object.values(g.markets)[0]!;
const biz: Business = cornerMod.create({
  id: bizId,
  ownerId: g.player.id,
  name: "Smoke Corner",
  locationId: market.id,
  tick: g.clock.tick,
  seed: g.seed,
});
biz.cash += loan.principal;

g = {
  ...g,
  player: { ...g.player, personalCash: g.player.personalCash - minDown },
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

console.log(
  `  Post-splice personal cash ${fmt$(g.player.personalCash)} · biz cash ${fmt$(g.businesses[biz.id]!.cash)}`,
);

// 4. Step one month.
const HPM = 24 * 30;
for (let i = 0; i < HPM; i++) g = stepTick(g);

const afterMonth = g.businessLoans[loan.id]!;
console.log(`\n[4] After 1 in-game month (tick ${g.clock.tick})`);
console.log(
  `  Loan balance ${fmt$(afterMonth.balance)} (down from ${fmt$(loan.balance)}) · missed ${afterMonth.missedPaymentsThisYear ?? 0}`,
);
console.log(
  `  Player cash ${fmt$(g.player.personalCash)} · biz cash ${fmt$(g.businesses[biz.id]!.cash)} · credit ${g.player.creditScore}`,
);
assert(afterMonth.balance < loan.balance, "Loan balance amortized");
assert(
  (afterMonth.missedPaymentsThisYear ?? 0) === 0,
  "No missed payments in month 1",
);
const bLoanLedgers = g.ledger.filter(
  (e) =>
    e.category === "business_loan_interest" ||
    e.category === "business_loan_principal" ||
    e.category === "business_loan_proceeds",
);
console.log(`  Business-loan ledger entries: ${bLoanLedgers.length}`);
assert(bLoanLedgers.length >= 2, "Interest + principal entries recorded");

// 5. Step 2 more months (total 3). v0.9 adds insolvency-forced
//    liquidation; pushing a 13-month horizon here reliably crosses the
//    4-week distress threshold and closes the business, removing the
//    loan record. A dedicated `smoke:bankruptcy` run (task #59) covers
//    that path. This test stays focused on amortization over a window
//    short enough for the store to stay solvent.
for (let i = 0; i < HPM * 2; i++) g = stepTick(g);
const afterYear = g.businessLoans[loan.id];
assert(!!afterYear, "Loan still present (business has not liquidated)");
console.log(`\n[5] After 3 in-game months (tick ${g.clock.tick})`);
console.log(
  `  Loan balance ${fmt$(afterYear!.balance)} (${Math.round(((loan.principal - afterYear!.balance) / loan.principal) * 100)}% paid)`,
);
console.log(
  `  Biz cash ${fmt$(g.businesses[biz.id]?.cash ?? 0)} · player cash ${fmt$(g.player.personalCash)} · credit ${g.player.creditScore}`,
);
assert(
  afterYear!.balance < afterMonth.balance,
  "Balance continues to amortize",
);

// 6. Net worth math.
const nw = computeNetWorth(g);
const debt = playerBusinessLoanDebt(g);
console.log(`\n[6] Net worth composition`);
console.log(`  Net worth ${fmt$(nw)} · outstanding business-loan debt ${fmt$(debt)}`);
assert(debt > 0, "Business-loan debt is being tracked");
// Compute raw (no debt) and confirm debt is indeed subtracted.
const raw = nw + debt;
assert(raw > nw, "Net worth reflects loan debt as a negative contribution");

// 7. Missed-payment stress test — force a loan far larger than business cash
//    can support, step one month, verify credit dings.
console.log(`\n[7] Missed-payment path`);
let stress = newGame({ seed: "bloan-stress", founderName: "Tester", difficulty: 3 });
const stressBizId = nanoid(8);
// v0.10.1: pick the weakest-desirability market so that even with the
// post-balance corner-store economy the business bleeds cash during
// the month and can't service the loan. Earlier the test used "first
// market" which — after the balance fix — could accidentally be a
// profitable neighborhood and mask a genuine miss.
const stressMkt = Object.values(stress.markets).sort(
  (a, b) => a.desirability - b.desirability,
)[0]!;
const stressMod = getBusinessModule("corner_store");
const stressBiz = stressMod.create({
  id: stressBizId,
  ownerId: stress.player.id,
  name: "Starved Corner",
  locationId: stressMkt.id,
  tick: 0,
  seed: stress.seed,
});
// Drain cash to guarantee a miss.
stressBiz.cash = 0;
const badLoan = originateBusinessLoan({
  id: nanoid(8),
  businessId: stressBizId,
  startupCostCents: 35_000_00,
  borrowCents: Math.floor(35_000_00 * maxLoanToCost(stress.player.creditScore)),
  creditScore: stress.player.creditScore,
  macro: stress.macro,
  tick: 0,
}).loan!;
stress = {
  ...stress,
  player: { ...stress.player, personalCash: 0, creditScore: 660 },
  businesses: { ...stress.businesses, [stressBizId]: stressBiz },
  businessLoans: { [badLoan.id]: badLoan },
};
const creditBefore = stress.player.creditScore;
for (let i = 0; i < HPM; i++) stress = stepTick(stress);
const creditAfter = stress.player.creditScore;
const missed = stress.businessLoans[badLoan.id]!.missedPaymentsThisYear ?? 0;
console.log(`  Credit ${creditBefore} → ${creditAfter} · missed ${missed}`);
assert(missed >= 1, "Missed payment registered");
assert(creditAfter < creditBefore, "Credit score dinged on miss");

console.log(`\nOK`);
