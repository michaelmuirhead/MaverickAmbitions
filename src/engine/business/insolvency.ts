/**
 * Insolvency state machine (v0.9 Failure & Flow).
 *
 * Runs once per week, right after the per-business `onWeek` roll-up in the
 * engine tick. For each player-owned business the check:
 *
 *   1. Updates `kpis.peakWeeklyRevenue` (high-watermark bookkeeping, used
 *      later in the postmortem ClosedBusinessRecord).
 *   2. Evaluates cash against the distress threshold (−$5,000).
 *   3. Advances the `status` / `insolvencyWeeks` state machine:
 *        operating → distressed → insolvent (at 4 consecutive weeks)
 *      with an early exit back to `operating` the moment cash recovers.
 *   4. Emits blocking game events on every meaningful transition so the
 *      fast-forward control (Day ▸ / Week ▸ / Event ▸) will halt and give
 *      the player a chance to react.
 *
 * Rival businesses are deliberately excluded — rival bankruptcy is a
 * different system (rivals self-liquidate via their AI loop) and rival-
 * owned distress should not pause the player's fast-forward.
 *
 * The state machine is intentionally lightweight and pure: it returns the
 * new `businesses` map plus events + the set of ids that just transitioned
 * to `insolvent`. The caller (engine tick) hands those ids to the
 * liquidation action, which performs the cascading debt-to-personal
 * collapse and filesystem-level close (see task #48).
 */

import type {
  Business,
  GameEvent,
  GameState,
  Id,
  Tick,
} from "@/types/game";

import { formatMoney } from "@/lib/money";

/** Cash threshold below which a business is considered distressed. −$5,000. */
export const INSOLVENCY_DISTRESS_THRESHOLD_CENTS = -500_000;

/** Consecutive distressed weeks before forced liquidation triggers. */
export const INSOLVENCY_WEEKS_TO_LIQUIDATION = 4;

export interface InsolvencyCheckResult {
  /** New businesses map with status / insolvencyWeeks / peakWeeklyRevenue updated. */
  businesses: Record<Id, Business>;
  /** Fully-formed game events ready to append to `state.events`. */
  events: GameEvent[];
  /**
   * Ids of businesses that transitioned to `insolvent` on this tick —
   * the caller hands these to the liquidation pipeline.
   */
  newlyInsolventIds: Id[];
}

/**
 * Given the current businesses map and the player id, return a new map
 * with the insolvency state machine advanced by one weekly step for each
 * player-owned business, plus any events to surface.
 *
 * Pure function — no RNG, no I/O.
 */
export function checkInsolvencyWeekly(
  state: GameState,
  tick: Tick,
): InsolvencyCheckResult {
  const nextBusinesses: Record<Id, Business> = { ...state.businesses };
  const events: GameEvent[] = [];
  const newlyInsolventIds: Id[] = [];
  const playerId = state.player.id;

  for (const biz of Object.values(state.businesses)) {
    // Only the player's businesses drive this state machine.
    if (biz.ownerId !== playerId) continue;

    const currentStatus: Business["status"] = biz.status ?? "operating";
    const currentWeeks = biz.insolvencyWeeks ?? 0;
    const underwater = biz.cash < INSOLVENCY_DISTRESS_THRESHOLD_CENTS;

    // 1. High-watermark bookkeeping. Tracks the best week this business
    //    has ever posted, surfaced later in the ClosedBusinessRecord.
    const weeklyRevenue = biz.kpis.weeklyRevenue;
    const prevPeak = biz.kpis.peakWeeklyRevenue ?? 0;
    const nextPeak = weeklyRevenue > prevPeak ? weeklyRevenue : prevPeak;

    // 2. State machine. Terminal `liquidated` should never be observed on
    //    an active record (the caller removes the record when it transitions
    //    through liquidation), but we defensively leave it alone here.
    if (currentStatus === "liquidated") {
      nextBusinesses[biz.id] = {
        ...biz,
        kpis: { ...biz.kpis, peakWeeklyRevenue: nextPeak },
      };
      continue;
    }

    let nextStatus: Business["status"] = currentStatus;
    let nextWeeks = currentWeeks;
    let nextDistressedSince = biz.distressedSince;

    if (underwater) {
      if (currentStatus === "operating") {
        // First week underwater — enter distress.
        nextStatus = "distressed";
        nextWeeks = 1;
        nextDistressedSince = tick;
        events.push(
          makeEvent(tick, biz, {
            title: `Cash crunch at ${biz.name}`,
            detail:
              `${biz.name} is ${formatMoney(
                Math.abs(biz.cash),
              )} under the insolvency line. ` +
              `${INSOLVENCY_WEEKS_TO_LIQUIDATION - 1} more weeks at this rate and the doors close. ` +
              `Infuse cash, close voluntarily, or cut expenses.`,
            blocking: true,
          }),
        );
      } else if (currentStatus === "distressed") {
        nextWeeks = currentWeeks + 1;
        if (nextWeeks >= INSOLVENCY_WEEKS_TO_LIQUIDATION) {
          // Fourth consecutive underwater week — insolvent. Liquidation
          // is handed off to the caller via newlyInsolventIds.
          nextStatus = "insolvent";
          newlyInsolventIds.push(biz.id);
          events.push(
            makeEvent(tick, biz, {
              title: `Insolvent: ${biz.name}`,
              detail:
                `${biz.name} has been underwater for ${INSOLVENCY_WEEKS_TO_LIQUIDATION} weeks. ` +
                `Forced liquidation incoming — assets will be sold at 40% of book and any ` +
                `outstanding business loan will collapse to your personal guarantee.`,
              blocking: true,
            }),
          );
        } else {
          // Weeks 2, 3 — keep warning the player while they still have
          //             a chance to rescue the business.
          const weeksLeft = INSOLVENCY_WEEKS_TO_LIQUIDATION - nextWeeks;
          events.push(
            makeEvent(tick, biz, {
              title: `Still underwater: ${biz.name}`,
              detail:
                `Week ${nextWeeks} of ${INSOLVENCY_WEEKS_TO_LIQUIDATION} distressed. ` +
                `${weeksLeft} week${weeksLeft === 1 ? "" : "s"} until forced liquidation.`,
              blocking: true,
            }),
          );
        }
      } else if (currentStatus === "insolvent") {
        // Already insolvent from a prior tick but liquidation hasn't run
        // yet (e.g. save was loaded mid-transition). Re-push the id so
        // the caller picks it up again.
        newlyInsolventIds.push(biz.id);
      }
    } else {
      // Above the distress line.
      if (currentStatus === "distressed" || currentStatus === "insolvent") {
        // Recovered. Clear the counter. Non-blocking event — the player
        // doesn't need to halt fast-forward for good news.
        nextStatus = "operating";
        nextWeeks = 0;
        nextDistressedSince = undefined;
        events.push(
          makeEvent(tick, biz, {
            title: `Recovered: ${biz.name}`,
            detail:
              `${biz.name} is back above the insolvency line (${formatMoney(
                biz.cash,
              )} cash). Distress counter reset.`,
            blocking: false,
          }),
        );
      }
      // operating + !underwater → no transition, no counter change.
    }

    nextBusinesses[biz.id] = {
      ...biz,
      status: nextStatus,
      insolvencyWeeks: nextWeeks,
      distressedSince: nextDistressedSince,
      kpis: { ...biz.kpis, peakWeeklyRevenue: nextPeak },
    };
  }

  return { businesses: nextBusinesses, events, newlyInsolventIds };
}

// ---------- helpers ----------

let eventSeq = 0;

function makeEvent(
  tick: Tick,
  biz: Business,
  spec: { title: string; detail: string; blocking: boolean },
): GameEvent {
  // Deterministic-ish id — tick+biz+monotonic counter. The caller will
  // eventually pass this to `events.push`; ids only need to be unique
  // within the current game session.
  eventSeq = (eventSeq + 1) % 1_000_000;
  return {
    id: `insolv-${tick}-${biz.id}-${eventSeq}`,
    tick,
    kind: "business_event",
    title: spec.title,
    detail: spec.detail,
    dismissed: false,
    blocking: spec.blocking,
  };
}
