import { useState } from "react";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ContentGrid } from "@/components/layout/ContentGrid";

import { useGameStore } from "@/state/store";
import { selectListingsInMarket, selectNetWorth } from "@/state/selectors";
import { formatMoney } from "@/lib/money";

import {
  getAvailableBusinessTypes,
  getBusinessModule,
} from "@/engine/business/registry";
import { hospitalityHalo } from "@/engine/economy/reputation";
import {
  BUSINESS_LOAN_MIN_CREDIT,
  BUSINESS_LOAN_TERM_MONTHS,
  businessLoanRate,
  maxLoanToCost,
} from "@/engine/economy/businessLoan";
import { monthlyPayment } from "@/engine/economy/finance";

import type { BusinessTypeId, Cents } from "@/types/game";

export function MarketPage() {
  const game = useGameStore((s) => s.game)!;
  const openBusiness = useGameStore((s) => s.openBusiness);
  const buyProperty = useGameStore((s) => s.buyProperty);
  const [banner, setBanner] = useState<string | undefined>();
  const types = getAvailableBusinessTypes();
  const modules = types.map((t) => ({ type: t, mod: getBusinessModule(t) }));
  const netWorth = selectNetWorth(game);
  const playerId = game.player.id;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Markets</h1>
        <p className="text-ink-400 text-sm mt-1">
          Pick a neighborhood, pick a play. Cafes trade higher capex for a
          reputation halo that boosts everything else you run here.
        </p>
      </header>

      <Card
        title="Macro"
        subtitle={`Phase ${game.macro.phase}`}
        trailing={
          <span className="text-xs text-ink-400">
            Rates {(game.macro.interestRate * 100).toFixed(2)}% · Wallet{" "}
            {(game.macro.consumerWallet * 100).toFixed(0)}% · Net worth{" "}
            {formatMoney(netWorth, { compact: true })}
          </span>
        }
      />

      {banner && (
        <div className="rounded-xl border border-loss-dark bg-loss/10 text-sm text-ink-50 px-3 py-2">
          {banner}
        </div>
      )}

      <ContentGrid>
        {Object.values(game.markets).map((m) => {
          const here = m.businessIds.length;
          const halo = hospitalityHalo(game, playerId, m.id);
          return (
            <Card
              key={m.id}
              title={m.name}
              subtitle={`Pop ${m.population.toLocaleString()} · Median ${formatMoney(m.medianIncome, { compact: true })}`}
            >
              <div className="text-xs text-ink-400 mb-3">
                Desirability {(m.desirability * 100).toFixed(0)}% · {here}{" "}
                business{here === 1 ? "" : "es"} operating
                {halo > 0 && (
                  <span className="ml-2 text-money">
                    · Your halo +{(halo * 100).toFixed(0)}%
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {modules.map(({ type, mod }) => {
                  const cost = mod.startup.startupCostCents;
                  const unlock = mod.startup.unlocksAt?.netWorthCents ?? 0;
                  const locked = netWorth < unlock;
                  const cashCovers = game.player.personalCash >= cost;

                  // Financing math — mirror `originateBusinessLoan` caps.
                  const creditScore = game.player.creditScore;
                  const ltc = maxLoanToCost(creditScore);
                  const maxBorrow = Math.floor(cost * ltc) as Cents;
                  const minDown = (cost - maxBorrow) as Cents;
                  const canFinance =
                    !cashCovers &&
                    creditScore >= BUSINESS_LOAN_MIN_CREDIT &&
                    ltc > 0 &&
                    game.player.personalCash >= minDown;
                  const rate = businessLoanRate(game.macro, creditScore);
                  const pmt = canFinance
                    ? (monthlyPayment(maxBorrow, rate, BUSINESS_LOAN_TERM_MONTHS) as Cents)
                    : (0 as Cents);

                  const financing = canFinance
                    ? { borrowCents: maxBorrow }
                    : undefined;
                  const disabled = locked || (!cashCovers && !canFinance);

                  let tooltip: string | undefined;
                  if (locked) {
                    tooltip = `Unlocks at ${formatMoney(unlock, { compact: true })} net worth`;
                  } else if (!cashCovers && !canFinance) {
                    if (creditScore < BUSINESS_LOAN_MIN_CREDIT) {
                      tooltip = `Need ${formatMoney(cost, { compact: true })} cash — credit ${creditScore} below ${BUSINESS_LOAN_MIN_CREDIT} for a business loan.`;
                    } else if (ltc === 0) {
                      tooltip = `Need ${formatMoney(cost, { compact: true })} cash — no financing available at credit ${creditScore}.`;
                    } else {
                      tooltip = `Need at least ${formatMoney(minDown, { compact: true })} cash as a down payment (you have ${formatMoney(game.player.personalCash, { compact: true })}).`;
                    }
                  } else if (canFinance) {
                    tooltip = `SBA loan ${formatMoney(maxBorrow, { compact: true })} @ ${(rate * 100).toFixed(2)}% · ${BUSINESS_LOAN_TERM_MONTHS}mo · ${formatMoney(pmt, { compact: true })}/mo · ${formatMoney(minDown, { compact: true })} down`;
                  }

                  let buttonLabel: string;
                  if (locked) {
                    buttonLabel = `${mod.ui.label} · locked`;
                  } else if (cashCovers) {
                    buttonLabel = `Open ${mod.ui.label.toLowerCase()} · ${formatMoney(cost, { compact: true })}`;
                  } else if (canFinance) {
                    buttonLabel = `Finance ${mod.ui.label.toLowerCase()} · ${formatMoney(minDown, { compact: true })} down · ${formatMoney(pmt, { compact: true })}/mo`;
                  } else {
                    buttonLabel = `${mod.ui.label} · need ${formatMoney(cost, { compact: true })}`;
                  }

                  return (
                    <Button
                      key={type}
                      size="sm"
                      variant={type === "cafe" ? "secondary" : "primary"}
                      disabled={disabled}
                      title={tooltip}
                      onClick={() => {
                        setBanner(undefined);
                        const res = openBusiness(
                          type as BusinessTypeId,
                          m.id,
                          defaultNameFor(type, m.name),
                          financing ? { financing } : undefined,
                        );
                        if (!res.ok) setBanner(res.error);
                        else if (res.loanId) {
                          setBanner(
                            `Opened a new ${mod.ui.label.toLowerCase()} in ${m.name} — financed ${formatMoney(maxBorrow, { compact: true })} at ${(rate * 100).toFixed(2)}%.`,
                          );
                        } else {
                          setBanner(`Opened a new ${mod.ui.label.toLowerCase()} in ${m.name}.`);
                        }
                      }}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span>{mod.ui.icon}</span>
                        <span>{buttonLabel}</span>
                      </span>
                    </Button>
                  );
                })}
              </div>

              {(() => {
                const listings = selectListingsInMarket(game, m.id).slice(0, 3);
                if (listings.length === 0) return null;
                return (
                  <div className="mt-4 pt-3 border-t border-ink-800/60">
                    <div className="text-xs uppercase tracking-wide text-ink-400 mb-2">
                      For sale ({selectListingsInMarket(game, m.id).length})
                    </div>
                    <div className="flex flex-col gap-2">
                      {listings.map((p) => {
                        const down = Math.round(p.listPriceCents! * 0.25);
                        const broke = game.player.personalCash < down;
                        return (
                          <div
                            key={p.id}
                            className="flex items-center justify-between gap-2 text-xs bg-ink-900/50 border border-ink-800/60 rounded-lg px-3 py-2"
                          >
                            <div className="flex flex-col min-w-0">
                              <span className="text-ink-50 truncate">
                                🏢 {p.address}
                              </span>
                              <span className="text-ink-400">
                                {p.class}-class · {p.sqft.toLocaleString()} sqft · {formatMoney(p.listPriceCents!, { compact: true })}
                              </span>
                            </div>
                            <Button
                              size="xs"
                              variant="secondary"
                              disabled={broke}
                              title={
                                broke
                                  ? `Need ${formatMoney(down, { compact: true })} for 25% down`
                                  : undefined
                              }
                              onClick={() => {
                                setBanner(undefined);
                                const res = buyProperty(p.id, down);
                                if (!res.ok) setBanner(res.error);
                                else
                                  setBanner(
                                    `Bought ${p.address} — ${formatMoney(down, { compact: true })} down, mortgage originated.`,
                                  );
                              }}
                            >
                              Buy · {formatMoney(down, { compact: true })} down
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </Card>
          );
        })}
      </ContentGrid>

      <p className="text-xs text-ink-500">
        Future industries will unlock additional market views — commercial real
        estate, labor pools, sports leagues, elections.
      </p>
    </div>
  );
}

function defaultNameFor(type: BusinessTypeId, marketName: string): string {
  if (type === "cafe") return `${marketName} Roast`;
  if (type === "corner_store") return `${marketName} Corner`;
  return `${marketName} ${type}`;
}
