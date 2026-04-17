import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ContentGrid } from "@/components/layout/ContentGrid";

import { useGameStore } from "@/state/store";
import { selectListingsInMarket, selectNetWorth } from "@/state/selectors";
import { formatMoney } from "@/lib/money";

import { STARTER_MARKETS } from "@/data/markets";
import { LAUNCH_REGION_ID, STARTER_REGIONS } from "@/data/regions";

import {
  BUSINESS_TYPE_CATEGORIES,
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
  const navigate = useNavigate();
  const [banner, setBanner] = useState<string | undefined>();
  const available = new Set(getAvailableBusinessTypes());
  // Group into categories for scannability (22+ types per market).
  const categorizedGroups = BUSINESS_TYPE_CATEGORIES.map((cat) => ({
    label: cat.label,
    modules: cat.types
      .filter((t) => available.has(t))
      .map((t) => ({ type: t, mod: getBusinessModule(t) })),
  })).filter((g) => g.modules.length > 0);
  const netWorth = selectNetWorth(game);
  const playerId = game.player.id;
  // Prefer the region record persisted on the save; fall back to the live
  // launch region so newly-migrated saves render the tagline immediately.
  const launchRegion =
    game.regions?.[LAUNCH_REGION_ID] ?? STARTER_REGIONS[LAUNCH_REGION_ID];

  return (
    <div className="space-y-4">
      <header>
        <div className="text-xs uppercase tracking-wide text-ink-500">
          {launchRegion.name}
        </div>
        <h1 className="text-2xl font-bold">Markets</h1>
        <p className="text-ink-400 text-sm mt-1">
          {launchRegion.tagline} Pick a neighborhood, pick a play. Cafes trade
          higher capex for a reputation halo that boosts everything else you
          run here.
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
          // Description lives on the Market record for fresh games; older
          // saves migrated in from v0.7.2 won't carry one, so fall back to
          // the live STARTER_MARKETS entry.
          const description =
            m.description ?? STARTER_MARKETS[m.id]?.description;
          return (
            <Card
              key={m.id}
              title={m.name}
              subtitle={`Pop ${m.population.toLocaleString()} · Median ${formatMoney(m.medianIncome, { compact: true })}`}
            >
              {description && (
                <p className="text-xs text-ink-300 mb-2 leading-relaxed">
                  {description}
                </p>
              )}
              <div className="text-xs text-ink-400 mb-3">
                Desirability {(m.desirability * 100).toFixed(0)}% · {here}{" "}
                business{here === 1 ? "" : "es"} operating
                {halo > 0 && (
                  <span className="ml-2 text-money">
                    · Your halo +{(halo * 100).toFixed(0)}%
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-3">
                {categorizedGroups.map((group) => (
                  <div key={group.label} className="flex flex-col gap-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-ink-500 pl-0.5">
                      {group.label}
                    </div>
                {group.modules.map(({ type, mod }) => {
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
                        if (!res.ok) {
                          setBanner(res.error);
                        } else {
                          // Jump straight to the new business's detail page so
                          // the player can set pricing / staffing before the
                          // first tick rolls.
                          if (res.businessId) {
                            navigate(`/business/${res.businessId}`);
                          }
                          if (res.loanId) {
                            setBanner(
                              `Opened a new ${mod.ui.label.toLowerCase()} in ${m.name} — financed ${formatMoney(maxBorrow, { compact: true })} at ${(rate * 100).toFixed(2)}%.`,
                            );
                          } else {
                            setBanner(
                              `Opened a new ${mod.ui.label.toLowerCase()} in ${m.name}.`,
                            );
                          }
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
                ))}
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
  switch (type) {
    case "cafe":
      return `${marketName} Roast`;
    case "corner_store":
      return `${marketName} Corner`;
    case "bar":
      return `${marketName} Tap`;
    case "restaurant":
      return `${marketName} Kitchen`;
    case "food_truck":
      return `${marketName} Truck`;
    case "pizza_shop":
      return `${marketName} Pies`;
    case "nightclub":
      return `${marketName} Lounge`;
    case "bookstore":
      return `${marketName} Books`;
    case "electronics_store":
      return `${marketName} Electronics`;
    case "florist":
      return `${marketName} Florist`;
    case "supermarket":
      return `${marketName} Market`;
    case "jewelry_store":
      return `${marketName} Jewelers`;
    case "clothing_retail":
      return `${marketName} Apparel`;
    case "suit_store":
      return `${marketName} Tailors`;
    case "furniture_store":
      return `${marketName} Furniture`;
    case "cinema":
      return `${marketName} Cinema`;
    case "movie_studio":
      return `${marketName} Pictures`;
    case "tech_startup":
      return `${marketName} Labs`;
    case "gaming_studio":
      return `${marketName} Interactive`;
    case "construction":
      return `${marketName} Builders`;
    case "hospital_clinic":
      return `${marketName} Clinic`;
    case "real_estate_firm":
      return `${marketName} Realty`;
    case "oil_gas":
      return `${marketName} Petroleum`;
    case "military_tech":
      return `${marketName} Defense`;
    default:
      return `${marketName} ${type.replace(/_/g, " ")}`;
  }
}
