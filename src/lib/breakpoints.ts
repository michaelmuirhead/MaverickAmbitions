/**
 * Device breakpoints. These must match tailwind.config.ts.
 *
 * Layout buckets — NOT just column counts:
 *   "phone"   — iPhone, bottom-nav, single column
 *   "tablet"  — iPad portrait/landscape, side-nav, multi-column
 *   "desktop" — browser window, side-nav + right rail, full workspace
 */

export type DeviceBucket = "phone" | "tablet" | "desktop";

export const BREAKPOINT_TABLET = 768;
export const BREAKPOINT_DESKTOP = 1280;

export function bucketForWidth(width: number): DeviceBucket {
  if (width >= BREAKPOINT_DESKTOP) return "desktop";
  if (width >= BREAKPOINT_TABLET) return "tablet";
  return "phone";
}
