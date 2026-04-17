/**
 * Long-term inflation drift. Separate from macro cycle: inflation
 * monotonically pushes baseline prices up over years.
 *
 * Exported as a helper — you call this on any cost/price that needs to
 * drift with time, rather than mutating base data.
 */

import { HOURS_PER_YEAR } from "@/lib/date";

/** Nominal 2.5%/yr long-run inflation. */
export const LONG_RUN_INFLATION = 0.025;

export function inflationMultiplier(tick: number): number {
  const years = tick / HOURS_PER_YEAR;
  return Math.pow(1 + LONG_RUN_INFLATION, years);
}
