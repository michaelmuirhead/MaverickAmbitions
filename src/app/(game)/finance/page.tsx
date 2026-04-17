"use client";

import { useState } from "react";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ContentGrid } from "@/components/layout/ContentGrid";
import { StatTile } from "@/components/ui/StatTile";

import { useGameStore } from "@/state/store";
import {
  selectCreditProfile,
  selectNetWorth,
  selectPlayerMortgageDebt,
  selectPlayerProperties,
  selectPlayerRealEstateEquity,
} from "@/state/selectors";
import { formatMoney } from "@/lib/money";

const BAND_COLORS: Record<string, string> = {
  emerald: "text-emerald-300",
  lime: "text-lime-300",
  amber: "text-amber-300",
  orange: "text-orange-300",
  red: "text-red-300",
};

export default function FinancePage() {
  const game = useGameStore((s) => s.game)!;
  const refinance = useGameStore((s) => s.refinance);
  const sellProperty = useGameStore((s) => s.sellProperty);
  const [banner, setBanner] = useState<string | undefined>();

  const credit = selectCreditProfile(game);
  const netWorth = selectNetWorth(game);
  const equity = selectPlayerRealEstateEquity(game);
  const mortgageDebt = selectPlayerMortgageDebt(game);
  const ownedProps = selectPlayerProperties(game);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Finance</h1>
        <p className="text-ink-400 text-sm mt-1">
          Your credit, real estate, and debt. Every missed mortgage payment
          costs 35 points. On-time streaks quietly build you back up.
        </p>
      </header>

      {banner && (
        <div className="rounded-xl border border-ink-700 bg-ink-900/60 text-sm text-ink-50 px-3 py-2">
          {banner}
        </div>
      )}

      <Card
        title="Credit profile"
        subtitle={`${credit.score} · ${credit.band.label}`}
        trailing={
          <span className={`text-xs ${BAND_COLORS[credit.band.color] ?? "text-ink-300"}`}>
            {(credit.quotedMortgageRate * 100).toFixed(2)}% quoted
          </span>
        }
      >
        <div className="grid grid-cols-3 gap-2 text-xs">
          <StatTile
            label="Max LTV"
            value={credit.band.minLtv > 0 ? `${Math.round(credit.band.minLtv * 100)}%` : "Denied"}
          />
          <StatTile
            label="Rate spread"
            value={`+${credit.band.spreadPct.toFixed(1)}%`}
          />
          <StatTile
            label="Missed YTD"
            value={String(credit.missedThisYear)}
            hint={credit.missedThisYear > 0 ? "Each −35 credit" : "Clean streak"}
          />
        </div>
      </Card>

      <ContentGrid>
        <StatTile label="Net worth" value={formatMoney(netWorth, { compact: true })} />
        <StatTile
          label="Real estate equity"
          value={formatMoney(equity, { compact: true })}
        />
        <StatTile
          label="Mortgage debt"
          value={formatMoney(mortgageDebt, { compact: true })}
        />
      </ContentGrid>

      <Card title="Your properties" subtitle={`${ownedProps.length} owned`}>
        {ownedProps.length === 0 ? (
          <p className="text-xs text-ink-400">
            You don&apos;t own any properties yet. Visit Markets to browse listings.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {ownedProps.map((p) => {
              const loan = p.mortgageId ? game.mortgages[p.mortgageId] : undefined;
              const equityP = p.valueCents - (loan?.balance ?? 0);
              const market = game.markets[p.marketId];
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-ink-800 bg-ink-900/40 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm text-ink-50 truncate">
                        🏢 {p.address}
                      </div>
                      <div className="text-xs text-ink-400">
                        {market?.name ?? p.marketId} · {p.class}-class · {p.sqft.toLocaleString()} sqft
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-ink-50">
                        {formatMoney(p.valueCents, { compact: true })}
                      </div>
                      <div className="text-ink-400">appraised</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
                    <div>
                      <div className="text-ink-400">Equity</div>
                      <div className="text-money">
                        {formatMoney(equityP, { compact: true })}
                      </div>
                    </div>
                    <div>
                      <div className="text-ink-400">Mortgage</div>
                      <div className="text-ink-50">
                        {loan
                          ? `${formatMoney(loan.balance, { compact: true })} @ ${(loan.annualRate * 100).toFixed(2)}%`
                          : "Paid off"}
                      </div>
                    </div>
                    <div>
                      <div className="text-ink-400">Payment</div>
                      <div className="text-ink-50">
                        {loan ? `${formatMoney(loan.monthlyPayment, { compact: true })}/mo` : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3">
                    {loan && (
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => {
                          setBanner(undefined);
                          const res = refinance(loan.id);
                          if (!res.ok) setBanner(res.error);
                          else
                            setBanner(
                              `Refinanced ${p.address} — new payment ${formatMoney(res.newPaymentCents ?? 0, { compact: true })}/mo.`,
                            );
                        }}
                      >
                        Refinance
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setBanner(undefined);
                        const res = sellProperty(p.id);
                        if (!res.ok) setBanner(res.error);
                        else
                          setBanner(
                            `Sold ${p.address} — ${formatMoney(res.proceedsCents ?? 0, { compact: true })} proceeds.`,
                          );
                      }}
                    >
                      Sell at appraisal
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <p className="text-xs text-ink-500">
        Mortgage, maintenance, and appreciation all settle once per in-game
        month. Rivals (operators) will compete for listings; disruptors rent.
      </p>
    </div>
  );
}
