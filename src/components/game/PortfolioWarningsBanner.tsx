/**
 * Dashboard-level portfolio warnings (v0.9 Failure & Flow).
 *
 * Aggregates three orthogonal failure signals and surfaces them as a
 * single actionable banner strip on the Dashboard:
 *
 *   1. Distressed businesses — any player-owned Business with
 *      `status === "distressed"`. Yellow. Links to the worst one.
 *   2. Insolvent businesses — any with `status === "insolvent"`. Red.
 *      These will forced-liquidate on the next weekly tick.
 *   3. Personal unsecured debt — `personalUnsecuredDebtCents > 0`.
 *      Shown once, deep red, with the ratio of discounted assets to the
 *      debt-service threshold so the player can see how close personal
 *      bankruptcy actually is.
 *   4. Active bankruptcy lockout — if `bankruptcyFlag` is set, show the
 *      remaining weeks.
 *
 * Rendering null when everything is clean keeps the Dashboard clean for
 * players who are running a healthy portfolio.
 */
import { Link } from "react-router-dom";

import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";

import type { Business, GameState, PlayerCharacter } from "@/types/game";
import { HOURS_PER_WEEK } from "@/lib/date";
import {
  INSOLVENCY_DEBT_SERVICE_RATIO,
  REAL_ESTATE_LIQUIDITY_DISCOUNT,
} from "@/engine/player/bankruptcy";
import { INSOLVENCY_WEEKS_TO_LIQUIDATION } from "@/engine/business/insolvency";

export interface PortfolioWarningsBannerProps {
  game: GameState;
}

export function PortfolioWarningsBanner({ game }: PortfolioWarningsBannerProps) {
  const player = game.player;
  const playerBiz = Object.values(game.businesses).filter(
    (b) => b.ownerId === player.id,
  );

  const insolvent = playerBiz.filter((b) => b.status === "insolvent");
  const distressed = playerBiz.filter((b) => b.status === "distressed");
  const personalDebt = player.personalUnsecuredDebtCents;
  const hasLockout = !!player.bankruptcyFlag;

  if (
    insolvent.length === 0 &&
    distressed.length === 0 &&
    personalDebt <= 0 &&
    !hasLockout
  )
    return null;

  return (
    <div className="space-y-2" data-testid="portfolio-warnings">
      {insolvent.length > 0 && (
        <InsolventRow businesses={insolvent} />
      )}
      {distressed.length > 0 && (
        <DistressedRow businesses={distressed} />
      )}
      {personalDebt > 0 && (
        <PersonalDebtRow game={game} />
      )}
      {hasLockout && (
        <BankruptcyLockoutRow player={player} currentTick={game.clock.tick} />
      )}
    </div>
  );
}

function InsolventRow({ businesses }: { businesses: Business[] }) {
  const worst = businesses[0]!;
  const rest = businesses.length - 1;
  return (
    <div
      className={cn(
        "rounded-xl border-2 px-4 py-3 flex items-start gap-3",
        "border-loss/70 bg-loss/10 text-loss",
      )}
      role="alert"
    >
      <span className="mt-1.5 h-2 w-2 rounded-full shrink-0 bg-loss" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          {businesses.length === 1
            ? "1 business insolvent — forced liquidation imminent"
            : `${businesses.length} businesses insolvent — forced liquidations imminent`}
        </div>
        <p className="text-xs text-ink-300 mt-0.5 leading-snug">
          The next weekly tick will auto-liquidate at 40% of book. Attached
          loans collapse to personal unsecured debt; credit −80 each. Close
          voluntarily now (60% / −40) to soften the landing.{" "}
          <Link
            to={`/business/${worst.id}`}
            className="underline underline-offset-2 hover:text-ink-50"
          >
            Review {worst.name}
          </Link>
          {rest > 0 && <> and {rest} other{rest === 1 ? "" : "s"}.</>}
        </p>
      </div>
    </div>
  );
}

function DistressedRow({ businesses }: { businesses: Business[] }) {
  // Show the "closest to forced-liquidation" business first.
  const worst = [...businesses].sort(
    (a, b) => (b.insolvencyWeeks ?? 0) - (a.insolvencyWeeks ?? 0),
  )[0]!;
  const weeks = worst.insolvencyWeeks ?? 0;
  const rest = businesses.length - 1;
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 flex items-start gap-3",
        "border-amber-700/70 bg-amber-950/40 text-amber-200",
      )}
      role="alert"
    >
      <span className="mt-1.5 h-2 w-2 rounded-full shrink-0 bg-amber-400" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          {businesses.length === 1
            ? "1 business distressed"
            : `${businesses.length} businesses distressed`}{" "}
          — {worst.name} is week {weeks} of {INSOLVENCY_WEEKS_TO_LIQUIDATION}
        </div>
        <p className="text-xs text-ink-300 mt-0.5 leading-snug">
          Cash is below the −$5K distress line. Recovering above −$5K at any
          weekly close resets the counter.{" "}
          <Link
            to={`/business/${worst.id}`}
            className="underline underline-offset-2 hover:text-amber-50"
          >
            Open {worst.name}
          </Link>
          {rest > 0 && <> (+{rest} more).</>}
        </p>
      </div>
    </div>
  );
}

function PersonalDebtRow({ game }: { game: GameState }) {
  const p = game.player;
  const reEquity = computeRealEstateEquity(game);
  const available =
    p.personalCash + Math.floor(REAL_ESTATE_LIQUIDITY_DISCOUNT * reEquity);
  const threshold = Math.floor(
    p.personalUnsecuredDebtCents * INSOLVENCY_DEBT_SERVICE_RATIO,
  );
  const cushion = available - threshold;
  const close = cushion < 0;
  const pct = threshold > 0 ? (available / threshold) * 100 : 0;

  return (
    <div
      className={cn(
        "rounded-xl border-2 px-4 py-3 flex items-start gap-3",
        close
          ? "border-loss/70 bg-loss/10 text-loss"
          : "border-amber-700/70 bg-amber-950/40 text-amber-200",
      )}
      role="alert"
    >
      <span
        className={cn(
          "mt-1.5 h-2 w-2 rounded-full shrink-0",
          close ? "bg-loss" : "bg-amber-400",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          {close
            ? "Personal bankruptcy likely on next weekly tick"
            : "Carrying unsecured personal debt"}
        </div>
        <p className="text-xs text-ink-300 mt-0.5 leading-snug">
          {formatMoney(p.personalUnsecuredDebtCents, { compact: true })}{" "}
          unsecured debt from business-loan collapse. Liquid + 50% of
          real-estate equity ={" "}
          <span className="font-mono">{formatMoney(available, { compact: true })}</span>
          , against a 25% debt-service threshold of{" "}
          <span className="font-mono">{formatMoney(threshold, { compact: true })}</span>{" "}
          (
          <span className="font-mono">
            {pct.toFixed(0)}%
          </span>
          ). Below 100% triggers Chapter 7: forecloses real estate at 90%,
          wipes remaining debt, credit to 300, 7-year lockout.
        </p>
      </div>
    </div>
  );
}

function BankruptcyLockoutRow({
  player,
  currentTick,
}: {
  player: PlayerCharacter;
  currentTick: number;
}) {
  const flag = player.bankruptcyFlag!;
  const remainingTicks = Math.max(0, flag.expiresAtTick - currentTick);
  const remainingWeeks = Math.ceil(remainingTicks / HOURS_PER_WEEK);
  const remainingYears = (remainingWeeks / 52).toFixed(1);
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 flex items-start gap-3",
        "border-ink-700 bg-ink-900/60 text-ink-200",
      )}
      role="status"
    >
      <span className="mt-1.5 h-2 w-2 rounded-full shrink-0 bg-ink-400" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          Chapter 7 lockout active — {remainingYears} years remaining
        </div>
        <p className="text-xs text-ink-400 mt-0.5 leading-snug">
          No new business loans. Commercial-lease finance bands halved. Real-
          estate down payments doubled. Lockout expires in{" "}
          {remainingWeeks.toLocaleString()} weeks.
        </p>
      </div>
    </div>
  );
}

/** Same math as bankruptcy.computeRealEstateEquity, inlined to avoid exporting. */
function computeRealEstateEquity(game: GameState): number {
  let eq = 0;
  for (const prop of Object.values(game.properties)) {
    if (prop.ownerId !== game.player.id) continue;
    const mortBal = prop.mortgageId
      ? (game.mortgages[prop.mortgageId]?.balance ?? 0)
      : 0;
    eq += Math.max(0, prop.valueCents - mortBal);
  }
  return eq;
}
