/**
 * Per-business distress banner (v0.9 Failure & Flow).
 *
 * Surfaces the insolvency state machine so the player can see, at a
 * glance, how close a business is to forced liquidation — and take
 * action (close voluntarily for 60% of book + −40 credit) before the
 * engine forces the 40% / −80 outcome at 4 consecutive distressed weeks.
 *
 * States:
 *   operating → no render
 *   distressed → amber banner with week counter (N of 4) and cash gap
 *   insolvent  → red banner: liquidation triggers on the next weekly tick
 *
 * Rival-owned businesses and closed businesses never reach this surface
 * (the page gates on `biz.ownerId === player.id` and deleted records
 * short-circuit via Navigate).
 */
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";

import type { Business } from "@/types/game";

import {
  INSOLVENCY_DISTRESS_THRESHOLD_CENTS,
  INSOLVENCY_WEEKS_TO_LIQUIDATION,
} from "@/engine/business/insolvency";
import { getBusinessModule } from "@/engine/business/registry";
import { RECOVERY_RATE } from "@/engine/business/liquidation";

export interface DistressBannerProps {
  biz: Business;
  /**
   * Called when the player confirms a voluntary close. Should invoke the
   * `closeBusinessVoluntarily` store action. The caller is responsible
   * for any post-close navigation (the business record disappears from
   * game.businesses the instant this resolves).
   */
  onCloseVoluntarily: () => void;
}

export function DistressBanner({ biz, onCloseVoluntarily }: DistressBannerProps) {
  const [confirming, setConfirming] = useState(false);
  const status = biz.status ?? "operating";
  if (status === "operating" || status === "liquidated") return null;

  const weeks = biz.insolvencyWeeks ?? 0;
  const cashGap = INSOLVENCY_DISTRESS_THRESHOLD_CENTS - biz.cash; // positive = how far below line
  const isInsolvent = status === "insolvent";

  const tone = isInsolvent
    ? "border-loss/70 bg-loss/10 text-loss"
    : "border-amber-700/70 bg-amber-950/40 text-amber-200";
  const dotTone = isInsolvent ? "bg-loss" : "bg-amber-400";
  const headline = isInsolvent
    ? "INSOLVENT — forced liquidation next weekly close"
    : `Distressed — week ${weeks} of ${INSOLVENCY_WEEKS_TO_LIQUIDATION} underwater`;

  const subDetail = isInsolvent
    ? "The sim will auto-liquidate this business at 40% of book on the next weekly tick. Attached business loans collapse to personal unsecured debt. Credit −80."
    : `Cash is ${formatMoney(-biz.cash, { sign: false })} in the red — ${formatMoney(
        cashGap,
      )} below the ${formatMoney(
        -INSOLVENCY_DISTRESS_THRESHOLD_CENTS,
      )} distress line. At ${INSOLVENCY_WEEKS_TO_LIQUIDATION} consecutive distressed weeks the engine force-liquidates at 40% of book (credit −80). Close voluntarily now for 60% recovery and only −40 credit.`;

  return (
    <div
      className={cn(
        "rounded-xl border-2 px-4 py-3 flex items-start gap-3",
        tone,
      )}
      role="alert"
      data-testid="distress-banner"
      data-status={status}
    >
      <span
        className={cn(
          "mt-1.5 h-2 w-2 rounded-full shrink-0",
          dotTone,
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{headline}</div>
        <p className="text-xs text-ink-300 mt-0.5 leading-snug">{subDetail}</p>

        {confirming ? (
          <div className="mt-3 rounded-lg border border-ink-700 bg-ink-900/60 p-2">
            <p className="text-xs text-ink-100">
              Close <span className="font-semibold">{biz.name}</span> now?
              Proceeds ≈{" "}
              <span className="font-mono">
                {formatMoney(estimateVoluntaryProceeds(biz), { compact: true })}
              </span>{" "}
              return to your personal account. Any business loan balance
              collapses to personal unsecured debt. Credit −40.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="xs"
                variant="danger"
                onClick={() => {
                  onCloseVoluntarily();
                  setConfirming(false);
                }}
              >
                Confirm close
              </Button>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setConfirming(true)}
              title="60% of book recovered · credit −40. Better than the 40% / −80 forced outcome."
            >
              Close voluntarily
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Mirrors the voluntary-close proceeds math in
 * engine/business/liquidation.ts so the banner can show the player what
 * they'll get before they confirm. Book value is the registry's startup
 * cost; the engine uses the same value when it actually closes.
 */
function estimateVoluntaryProceeds(biz: Business): number {
  const mod = getBusinessModule(biz.type);
  const book = mod.startup.startupCostCents;
  return Math.floor(book * RECOVERY_RATE.voluntary_close);
}
