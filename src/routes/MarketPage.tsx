import { useState } from "react";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ContentGrid } from "@/components/layout/ContentGrid";
import { BuyBusinessDialog } from "@/components/game/BuyBusinessDialog";

import { useGameStore } from "@/state/store";
import { selectListingsInMarket, selectNetWorth } from "@/state/selectors";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";

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
import { recommendForMarket } from "@/engine/market/recommendations";

import type {
  BusinessTypeId,
  Cents,
  GameState,
  Market,
  PlayerCharacter,
} from "@/types/game";

/**
 * MarketPage (v0.9 reorganization).
 *
 * Each market card now shows three sections:
 *
 *   1. **Good fits here** — top ~4 recommendations, scored by the
 *      market-fit engine, with a one-line "why" under each button.
 *   2. **Already operating here** — occupant roster so the player can
 *      read the competitive landscape before opening another.
 *   3. **All business types** — collapsed by default; the original
 *      categorized grid for explicitly browsing every option.
 *
 * The for-sale property rail remains at the bottom of each card.
 */
export function MarketPage() {
  const game = useGameStore((s) => s.game)!;
  const buyProperty = useGameStore((s) => s.buyProperty);
  const [banner, setBanner] = useState<string | undefined>();
  const [dialog, setDialog] = useState<
    { type: BusinessTypeId; market: Market; defaultName: string } | undefined
  >();
  const netWorth = selectNetWorth(game);
  const playerId = game.player.id;
  const availableTypes = getAvailableBusinessTypes();
  const openDialog = (
    type: BusinessTypeId,
    market: Market,
  ) => setDialog({ type, market, defaultName: defaultNameFor(type, market.name) });

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

              <GoodFitsSection
                market={m}
                availableTypes={availableTypes}
                game={game}
                onOpen={openDialog}
              />

              <OccupantsSection market={m} game={game} />

              <AllTypesSection
                market={m}
                game={game}
                onOpen={openDialog}
              />

              <PropertyRail
                market={m}
                game={game}
                buyProperty={buyProperty}
                onBanner={setBanner}
              />
            </Card>
          );
        })}
      </ContentGrid>

      <p className="text-xs text-ink-500">
        Future industries will unlock additional market views — commercial real
        estate, labor pools, sports leagues, elections.
      </p>

      <BuyBusinessDialog
        type={dialog?.type}
        market={dialog?.market}
        defaultName={dialog?.defaultName}
        onClose={() => setDialog(undefined)}
        onBanner={(msg) => setBanner(msg)}
      />
    </div>
  );
}

// ---------- Good fits section ----------

function GoodFitsSection({
  market,
  availableTypes,
  game,
  onOpen,
}: {
  market: Market;
  availableTypes: BusinessTypeId[];
  game: GameState;
  onOpen: (type: BusinessTypeId, market: Market) => void;
}) {
  const recs = recommendForMarket(market, availableTypes, {
    player: game.player,
    topN: 4,
  });
  if (recs.length === 0) {
    return (
      <div className="rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-2 text-xs text-ink-400 mb-3">
        No standout fits for this market — browse{" "}
        <span className="text-ink-200">All business types</span> below to
        explore options.
      </div>
    );
  }
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-500 pl-0.5 mb-1.5">
        Good fits here
      </div>
      <div className="flex flex-col gap-1.5">
        {recs.map((r) => {
          const reason = r.reasons[0];
          return (
            <OpenBusinessButton
              key={r.type}
              type={r.type}
              market={market}
              game={game}
              highlight
              extraLine={reason}
              onOpen={onOpen}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------- Occupants section ----------

function OccupantsSection({
  market,
  game,
}: {
  market: Market;
  game: GameState;
}) {
  const occupants = market.businessIds
    .map((id) => game.businesses[id])
    .filter((b): b is NonNullable<typeof b> => !!b);
  if (occupants.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-500 pl-0.5 mb-1.5">
        Already operating here ({occupants.length})
      </div>
      <ul className="rounded-lg border border-ink-800 bg-ink-900/40 divide-y divide-ink-800/60">
        {occupants.map((b) => {
          const mod = tryGetModule(b.type);
          const yours = b.ownerId === game.player.id;
          return (
            <li
              key={b.id}
              className="flex items-center justify-between px-3 py-1.5 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span aria-hidden>{mod?.ui.icon ?? "🏪"}</span>
                <span className="truncate text-ink-100">{b.name}</span>
                <span className="text-ink-500 shrink-0">
                  · {mod?.ui.label ?? b.type}
                </span>
              </div>
              <span
                className={cn(
                  "shrink-0 font-semibold",
                  yours ? "text-accent" : "text-ink-400",
                )}
              >
                {yours ? "You" : "Rival"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- All types (collapsed) section ----------

function AllTypesSection({
  market,
  game,
  onOpen,
}: {
  market: Market;
  game: GameState;
  onOpen: (type: BusinessTypeId, market: Market) => void;
}) {
  const available = new Set(getAvailableBusinessTypes());
  const groups = BUSINESS_TYPE_CATEGORIES.map((cat) => ({
    label: cat.label,
    types: cat.types.filter((t) => available.has(t)),
  })).filter((g) => g.types.length > 0);

  return (
    <details className="mb-3 rounded-lg border border-ink-800 bg-ink-900/30 group">
      <summary className="cursor-pointer select-none px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 font-semibold hover:text-ink-200">
        All business types ({getAvailableBusinessTypes().length})
      </summary>
      <div className="px-3 pb-3 pt-1 flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1.5">
            <div className="text-[10px] uppercase tracking-wider text-ink-500 pl-0.5">
              {group.label}
            </div>
            {group.types.map((type) => (
              <OpenBusinessButton
                key={type}
                type={type}
                market={market}
                game={game}
                onOpen={onOpen}
              />
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

// ---------- Shared open button ----------

function OpenBusinessButton({
  type,
  market,
  game,
  highlight,
  extraLine,
  onOpen,
}: {
  type: BusinessTypeId;
  market: Market;
  game: GameState;
  highlight?: boolean;
  extraLine?: string;
  onOpen: (type: BusinessTypeId, market: Market) => void;
}) {
  const mod = getBusinessModule(type);
  const netWorth = selectNetWorth(game);
  const plan = planOpen(type, mod, market, game.player, game, netWorth);

  return (
    <div className="flex flex-col">
      <Button
        size="sm"
        variant={highlight ? "primary" : type === "cafe" ? "secondary" : "primary"}
        disabled={plan.disabled}
        title={plan.tooltip}
        onClick={() => onOpen(type, market)}
      >
        <span className="inline-flex items-center gap-2">
          <span aria-hidden>{mod.ui.icon}</span>
          <span>{plan.label}</span>
        </span>
      </Button>
      {extraLine && (
        <p className="text-[10px] text-ink-400 mt-0.5 pl-0.5 leading-snug">
          {extraLine}
        </p>
      )}
    </div>
  );
}

// ---------- Property rail ----------

function PropertyRail({
  market,
  game,
  buyProperty,
  onBanner,
}: {
  market: Market;
  game: GameState;
  buyProperty: ReturnType<typeof useGameStore.getState>["buyProperty"];
  onBanner: (m: string | undefined) => void;
}) {
  const all = selectListingsInMarket(game, market.id);
  const listings = all.slice(0, 3);
  if (listings.length === 0) return null;
  return (
    <div className="mt-4 pt-3 border-t border-ink-800/60">
      <div className="text-xs uppercase tracking-wide text-ink-400 mb-2">
        For sale ({all.length})
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
                <span className="text-ink-50 truncate">🏢 {p.address}</span>
                <span className="text-ink-400">
                  {p.class}-class · {p.sqft.toLocaleString()} sqft ·{" "}
                  {formatMoney(p.listPriceCents!, { compact: true })}
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
                  onBanner(undefined);
                  const res = buyProperty(p.id, down);
                  if (!res.ok) onBanner(res.error);
                  else
                    onBanner(
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
}

// ---------- Shared open-plan calculation ----------

interface OpenPlan {
  disabled: boolean;
  tooltip?: string;
  label: string;
  financing?: { borrowCents: Cents };
  rate: number;
}

function planOpen(
  type: BusinessTypeId,
  mod: ReturnType<typeof getBusinessModule>,
  market: Market,
  player: PlayerCharacter,
  _game: GameState,
  netWorth: number,
): OpenPlan {
  const cost = mod.startup.startupCostCents;
  const unlock = mod.startup.unlocksAt?.netWorthCents ?? 0;
  const locked = netWorth < unlock;
  const cashCovers = player.personalCash >= cost;

  // Financing math — mirror `originateBusinessLoan` caps.
  const creditScore = player.creditScore;
  const ltc = maxLoanToCost(creditScore);
  const maxBorrow = Math.floor(cost * ltc) as Cents;
  const minDown = (cost - maxBorrow) as Cents;
  const canFinance =
    !cashCovers &&
    creditScore >= BUSINESS_LOAN_MIN_CREDIT &&
    ltc > 0 &&
    player.personalCash >= minDown;
  // Reference macro via the market's containing state via `_game` — but
  // since businessLoanRate takes macro directly we thread it via mod's
  // containing game. Keep the interface simple by reading off _game.
  const macro = _game.macro;
  const rate = businessLoanRate(macro, creditScore);
  const pmt = canFinance
    ? (monthlyPayment(maxBorrow, rate, BUSINESS_LOAN_TERM_MONTHS) as Cents)
    : (0 as Cents);

  const financing = canFinance ? { borrowCents: maxBorrow } : undefined;
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
      tooltip = `Need at least ${formatMoney(minDown, { compact: true })} cash as a down payment (you have ${formatMoney(player.personalCash, { compact: true })}).`;
    }
  } else if (canFinance) {
    tooltip = `SBA loan ${formatMoney(maxBorrow, { compact: true })} @ ${(rate * 100).toFixed(2)}% · ${BUSINESS_LOAN_TERM_MONTHS}mo · ${formatMoney(pmt, { compact: true })}/mo · ${formatMoney(minDown, { compact: true })} down`;
  }

  let label: string;
  if (locked) {
    label = `${mod.ui.label} · locked`;
  } else if (cashCovers) {
    label = `Open ${mod.ui.label.toLowerCase()} · ${formatMoney(cost, { compact: true })}`;
  } else if (canFinance) {
    label = `Finance ${mod.ui.label.toLowerCase()} · ${formatMoney(minDown, { compact: true })} down · ${formatMoney(pmt, { compact: true })}/mo`;
  } else {
    label = `${mod.ui.label} · need ${formatMoney(cost, { compact: true })}`;
  }

  // Silence unused-parameter warnings for the destructured market/type —
  // they may be consumed later by market-specific open flows.
  void market;
  void type;

  return { disabled, tooltip, label, financing, rate };
}

function tryGetModule(type: BusinessTypeId) {
  try {
    return getBusinessModule(type);
  } catch {
    return undefined;
  }
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
