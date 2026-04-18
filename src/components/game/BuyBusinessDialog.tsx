/**
 * Buy Business dialog (v0.9 Failure & Flow).
 *
 * Replaces the one-click "Open" path on MarketPage with a confirm modal
 * so the player can make the lease-vs-own decision before spinning up
 * a new business. The modal is a thin wrapper over the existing
 * `openBusiness` store action — all finance math still lives in the
 * store and engine.
 *
 * Two location options:
 *   1. Lease (default) — commercial rent is drawn monthly by the
 *      business module. No property picker.
 *   2. Use an owned property — the player picks from their *vacant*
 *      player-owned properties in this market. The selected property's
 *      `hostedBusinessId` is set; its rent draw is suppressed; monthly
 *      settlement routes maintenance and value revaluation as usual.
 *
 * Financing is auto-selected: if the player has cash to cover 100%,
 * no loan; otherwise an SBA-style business loan caps at the credit-
 * gated LTC with the player covering the down payment. This mirrors
 * the inline button on the old MarketPage layout.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";

import { useGameStore } from "@/state/store";
import { selectNetWorth } from "@/state/selectors";

import {
  BUSINESS_LOAN_MIN_CREDIT,
  BUSINESS_LOAN_TERM_MONTHS,
  businessLoanRate,
  maxLoanToCost,
} from "@/engine/economy/businessLoan";
import { monthlyPayment } from "@/engine/economy/finance";
import { getBusinessModule } from "@/engine/business/registry";

import type {
  BusinessTypeId,
  Cents,
  GameState,
  Market,
  PlayerCharacter,
  Property,
} from "@/types/game";

export interface BuyBusinessDialogProps {
  /** Which business type to open. When undefined, the dialog is hidden. */
  type?: BusinessTypeId;
  /** Which market to open it in. */
  market?: Market;
  /** Default name seed — MarketPage supplies a market-flavored default. */
  defaultName?: string;
  /** Close without opening. */
  onClose: () => void;
  /** Optional banner sink for success / error messages. */
  onBanner?: (msg: string) => void;
}

type LocationChoice = "lease" | "own";

export function BuyBusinessDialog({
  type,
  market,
  defaultName,
  onClose,
  onBanner,
}: BuyBusinessDialogProps) {
  const game = useGameStore((s) => s.game);
  const openBusiness = useGameStore((s) => s.openBusiness);
  const navigate = useNavigate();

  const [choice, setChoice] = useState<LocationChoice>("lease");
  const [propertyId, setPropertyId] = useState<string | undefined>();
  const [name, setName] = useState(defaultName ?? "");

  // Keep defaults fresh when the dialog is reopened for a different target.
  useEffect(() => {
    setChoice("lease");
    setPropertyId(undefined);
    setName(defaultName ?? "");
  }, [type, market?.id, defaultName]);

  if (!type || !market || !game) return null;

  const mod = getBusinessModule(type);
  const netWorth = selectNetWorth(game);
  const plan = computePlan(mod, game.player, game, netWorth);

  // Candidate properties = vacant, player-owned, in this market.
  const candidates = selectVacantPlayerProps(game, market.id);

  const effectivePropertyId = choice === "own" ? propertyId : undefined;
  // A buy-property choice requires a selection.
  const propertyValid =
    choice === "lease" || (choice === "own" && !!propertyId);

  const disabled = plan.disabled || !propertyValid || name.trim() === "";

  const confirm = () => {
    const res = openBusiness(
      type,
      market.id,
      name.trim() || (defaultName ?? mod.ui.label),
      {
        propertyId: effectivePropertyId,
        financing: plan.financing,
      },
    );
    if (!res.ok) {
      onBanner?.(res.error ?? "Couldn't open the business.");
      return;
    }
    onBanner?.(
      plan.financing
        ? `Opened ${name.trim() || mod.ui.label} in ${market.name} — financed ${formatMoney(plan.financing.borrowCents, { compact: true })} at ${(plan.rate * 100).toFixed(2)}%.`
        : `Opened ${name.trim() || mod.ui.label} in ${market.name}.`,
    );
    onClose();
    if (res.businessId) navigate(`/business/${res.businessId}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="buy-business-title"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-ink-800 bg-ink-900 shadow-card p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="text-3xl leading-none" aria-hidden>
            {mod.ui.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-ink-500">
              Open in {market.name}
            </div>
            <h2
              id="buy-business-title"
              className="text-lg font-semibold text-ink-50"
            >
              {mod.ui.label}
            </h2>
            <div className="text-xs text-ink-400 mt-0.5">
              Startup {formatMoney(mod.startup.startupCostCents, { compact: true })}{" "}
              · {plan.summary}
            </div>
          </div>
        </div>

        {/* Name field */}
        <label className="mt-4 block">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 mb-1">
            Business name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName ?? mod.ui.label}
            className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-500 focus:border-accent focus:outline-none"
          />
        </label>

        {/* Location choice */}
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-500 mb-2">
            Location
          </div>
          <div className="space-y-2">
            <LocationOption
              active={choice === "lease"}
              onSelect={() => setChoice("lease")}
              title="Lease commercial space"
              blurb="Default. Monthly rent is pulled from the business's operating cash based on market desirability and business type. Cheapest way in."
            />
            <LocationOption
              active={choice === "own"}
              onSelect={() => setChoice("own")}
              title="Use a property I own"
              blurb={
                candidates.length === 0
                  ? "No vacant properties you own in this market. Buy one from the market listings first, or pick another location."
                  : "Host the business on a property you already own. No rent line — monthly maintenance still draws from personal cash."
              }
              disabled={candidates.length === 0}
            />
          </div>

          {choice === "own" && candidates.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {candidates.map((p) => {
                const selected = p.id === propertyId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPropertyId(p.id)}
                    aria-pressed={selected}
                    className={cn(
                      "w-full text-left rounded-lg border px-3 py-2 transition-colors",
                      selected
                        ? "border-accent bg-accent/10 text-ink-50"
                        : "border-ink-800 bg-ink-900/50 hover:border-ink-700 text-ink-200",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm truncate">
                          🏢 {p.address}
                        </span>
                        <span className="text-[11px] text-ink-400">
                          {p.class}-class · {p.sqft.toLocaleString()} sqft ·
                          value {formatMoney(p.valueCents, { compact: true })}
                        </span>
                      </div>
                      {selected && (
                        <span className="text-[10px] uppercase tracking-wide text-accent font-semibold shrink-0">
                          Selected
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Finance summary */}
        <div className="mt-4 rounded-lg border border-ink-800 bg-ink-950/70 p-3 text-xs text-ink-300 space-y-0.5">
          {plan.lines.map((l, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span>{l.label}</span>
              <span className="font-mono text-ink-100">{l.value}</span>
            </div>
          ))}
        </div>

        {plan.blocker && (
          <div className="mt-3 rounded-lg border border-loss/60 bg-loss/10 px-3 py-2 text-xs text-loss">
            {plan.blocker}
          </div>
        )}

        {/* Actions */}
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={disabled}
            onClick={confirm}
          >
            {choice === "own"
              ? "Open on owned property"
              : plan.financing
                ? "Open with financing"
                : "Open"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------- subcomponents ----------

function LocationOption({
  active,
  onSelect,
  title,
  blurb,
  disabled,
}: {
  active: boolean;
  onSelect: () => void;
  title: string;
  blurb: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        "w-full text-left rounded-lg border px-3 py-2 transition-colors",
        active
          ? "border-accent bg-accent/10 text-ink-50"
          : "border-ink-800 hover:border-ink-700 hover:bg-ink-900/50 text-ink-200",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      <div className="text-sm font-semibold flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            active ? "bg-accent" : "bg-ink-700",
          )}
        />
        {title}
      </div>
      <p className="text-xs text-ink-400 mt-1 leading-snug">{blurb}</p>
    </button>
  );
}

// ---------- helpers ----------

interface PlanSummary {
  disabled: boolean;
  summary: string;
  lines: Array<{ label: string; value: string }>;
  financing?: { borrowCents: Cents };
  rate: number;
  blocker?: string;
}

function computePlan(
  mod: ReturnType<typeof getBusinessModule>,
  player: PlayerCharacter,
  game: GameState,
  netWorth: number,
): PlanSummary {
  const cost = mod.startup.startupCostCents;
  const unlock = mod.startup.unlocksAt?.netWorthCents ?? 0;
  const locked = netWorth < unlock;

  const cashCovers = player.personalCash >= cost;
  const creditScore = player.creditScore;
  const ltc = maxLoanToCost(creditScore);
  const maxBorrow = Math.floor(cost * ltc) as Cents;
  const minDown = (cost - maxBorrow) as Cents;
  const canFinance =
    !cashCovers &&
    creditScore >= BUSINESS_LOAN_MIN_CREDIT &&
    ltc > 0 &&
    player.personalCash >= minDown;

  const rate = businessLoanRate(game.macro, creditScore);
  const pmt = canFinance
    ? (monthlyPayment(maxBorrow, rate, BUSINESS_LOAN_TERM_MONTHS) as Cents)
    : (0 as Cents);

  const financing = canFinance ? { borrowCents: maxBorrow } : undefined;
  const disabled = locked || (!cashCovers && !canFinance);

  const lines: Array<{ label: string; value: string }> = [];
  lines.push({
    label: "Personal cash",
    value: formatMoney(player.personalCash, { compact: true }),
  });
  lines.push({
    label: "Startup cost",
    value: formatMoney(cost, { compact: true }),
  });
  if (cashCovers) {
    lines.push({ label: "Down payment", value: formatMoney(cost, { compact: true }) });
    lines.push({ label: "Financing", value: "None" });
  } else if (canFinance) {
    lines.push({
      label: "Down payment",
      value: formatMoney(minDown, { compact: true }),
    });
    lines.push({
      label: "SBA loan",
      value: `${formatMoney(maxBorrow, { compact: true })} @ ${(rate * 100).toFixed(2)}% · ${formatMoney(pmt, { compact: true })}/mo`,
    });
  }

  let summary = "";
  let blocker: string | undefined;
  if (locked) {
    summary = `Locked — unlocks at ${formatMoney(unlock, { compact: true })} net worth`;
    blocker = `Unlocks at ${formatMoney(unlock, { compact: true })} net worth (you're at ${formatMoney(netWorth, { compact: true })}).`;
  } else if (cashCovers) {
    summary = "All cash";
  } else if (canFinance) {
    summary = "Financed";
  } else if (creditScore < BUSINESS_LOAN_MIN_CREDIT) {
    summary = "No financing";
    blocker = `Credit ${creditScore} is below ${BUSINESS_LOAN_MIN_CREDIT} — need ${formatMoney(cost, { compact: true })} in cash.`;
  } else if (ltc === 0) {
    summary = "No financing";
    blocker = `No financing available at credit ${creditScore} — need ${formatMoney(cost, { compact: true })} in cash.`;
  } else {
    summary = "Down payment short";
    blocker = `Need at least ${formatMoney(minDown, { compact: true })} in personal cash for the down payment.`;
  }

  return { disabled, summary, lines, financing, rate, blocker };
}

function selectVacantPlayerProps(game: GameState, marketId: string): Property[] {
  const pid = game.player.id;
  const out: Property[] = [];
  for (const p of Object.values(game.properties)) {
    if (p.marketId !== marketId) continue;
    if (p.ownerId !== pid) continue;
    if (p.hostedBusinessId) continue;
    out.push(p);
  }
  return out.sort((a, b) => b.valueCents - a.valueCents);
}
