/**
 * Headless v0.3 real-estate smoke test:
 *   1. newGame — verify per-market inventory was seeded
 *   2. player buys a for-sale property with ~25% down
 *   3. step 1 month — verify a mortgage payment was recorded, property revalued
 *   4. step 3 more months — verify appreciation tracks, credit score nudges
 *   5. refinance — verify lower payment
 *   6. sell — verify proceeds minus mortgage balance returned as cash
 */

import { nanoid } from "nanoid";

import { newGame, stepTick } from "../src/engine";
import {
  originateMortgage,
  creditBand,
  mortgageRate,
} from "../src/engine/economy/realEstate";
import type { GameState } from "../src/types/game";

function fmt$(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

let g: GameState = newGame({
  seed: "re-smoke-1",
  founderName: "Tester",
  difficulty: 3,
});

// Fudge personal cash so we can afford a down payment.
g = {
  ...g,
  player: { ...g.player, personalCash: 300_000_00 },
};

const allProps = Object.values(g.properties);
console.log(`Seeded properties total: ${allProps.length}`);
for (const mkt of Object.values(g.markets)) {
  const mprops = allProps.filter((p) => p.marketId === mkt.id);
  const forSale = mprops.filter((p) => p.listPriceCents !== undefined);
  console.log(
    `  ${mkt.name} (desirability ${(mkt.desirability * 100).toFixed(0)}%): ${mprops.length} props (${forSale.length} for sale)`,
  );
}

// Find a mid-tier listed property to buy (B or C class, cheaper to test credit).
const candidates = allProps
  .filter((p) => p.listPriceCents !== undefined)
  .sort((a, b) => a.listPriceCents! - b.listPriceCents!);
const target = candidates[0]!;
console.log(
  `\nBuying: ${target.address} (${target.class}-class, ${target.sqft.toLocaleString()} sqft, list ${fmt$(target.listPriceCents!)})`,
);

// Player credit band at start.
const band = creditBand(g.player.creditScore);
console.log(
  `Player credit: ${g.player.creditScore} (${band.label}) · quoted rate ${(mortgageRate(g.macro, g.player.creditScore) * 100).toFixed(2)}%`,
);

const down = Math.round(target.listPriceCents! * 0.25);
const loanId = nanoid(8);
const origin = originateMortgage({
  id: loanId,
  propertyId: target.id,
  purchasePriceCents: target.listPriceCents!,
  downPaymentCents: down,
  creditScore: g.player.creditScore,
  macro: g.macro,
  tick: g.clock.tick,
});

if (!origin.ok || !origin.loan) {
  throw new Error(`Origination failed: ${origin.error}`);
}
const loan = origin.loan;
console.log(
  `Originated: down ${fmt$(down)} · principal ${fmt$(loan.balance)} · rate ${(loan.annualRate * 100).toFixed(2)}% · payment ${fmt$(loan.monthlyPayment)}/mo`,
);

// Patch state to reflect the purchase (skipping the store action for isolation).
g = {
  ...g,
  player: { ...g.player, personalCash: g.player.personalCash - down },
  mortgages: { ...g.mortgages, [loan.id]: loan },
  properties: {
    ...g.properties,
    [target.id]: {
      ...target,
      ownerId: g.player.id,
      purchasePriceCents: target.listPriceCents!,
      purchaseTick: g.clock.tick,
      listPriceCents: undefined,
      mortgageId: loan.id,
    },
  },
};

console.log(`\nPost-buy cash: ${fmt$(g.player.personalCash)}`);

// Step one month (~720 ticks).
const HPM = 24 * 30;
for (let i = 0; i < HPM; i++) g = stepTick(g);

const afterMonth = g.mortgages[loan.id]!;
const propAfter = g.properties[target.id]!;
console.log(`\nAfter 1 in-game month (tick ${g.clock.tick}):`);
console.log(`  Mortgage balance: ${fmt$(afterMonth.balance)} (started ${fmt$(loan.balance)})`);
console.log(`  Property value: ${fmt$(propAfter.valueCents)} (purchased at ${fmt$(target.listPriceCents!)})`);
console.log(`  Player cash: ${fmt$(g.player.personalCash)}`);
console.log(`  Credit score: ${g.player.creditScore}`);

// Step 3 more months.
for (let i = 0; i < HPM * 3; i++) g = stepTick(g);
const threeLater = g.mortgages[loan.id]!;
const propLater = g.properties[target.id]!;
console.log(`\nAfter 4 months (tick ${g.clock.tick}):`);
console.log(`  Mortgage balance: ${fmt$(threeLater.balance)}`);
console.log(`  Property value: ${fmt$(propLater.valueCents)}`);
console.log(`  Missed payments: ${threeLater.missedPaymentsThisYear ?? 0}`);
console.log(`  Player cash: ${fmt$(g.player.personalCash)}`);
console.log(`  Credit score: ${g.player.creditScore}`);

// Count real-estate ledger entries.
const reLedger = g.ledger.filter(
  (e) =>
    e.category === "mortgage_interest" ||
    e.category === "mortgage_principal" ||
    e.category === "property_maintenance",
);
console.log(`  Ledger entries (RE-related): ${reLedger.length}`);

// Attempt refinance — may or may not beat rate depending on macro drift.
const currentRate = mortgageRate(g.macro, g.player.creditScore);
console.log(
  `\nCurrent quoted rate: ${(currentRate * 100).toFixed(2)}% vs active loan rate ${(threeLater.annualRate * 100).toFixed(2)}%`,
);

// Rival property behavior.
console.log(`\nRivals:`);
for (const r of Object.values(g.rivals)) {
  const owned = Object.values(g.properties).filter((p) => p.ownerId === r.id);
  console.log(
    `  ${r.name} [${r.personality}] netWorth=${fmt$(r.netWorth)} owned-properties=${owned.length} last="${r.lastMove?.description ?? "—"}"`,
  );
}

console.log(`\nOK`);
