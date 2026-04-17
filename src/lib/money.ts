/**
 * Money helpers. All money is integer cents internally.
 */

import type { Cents } from "@/types/game";

export const CENTS_PER_DOLLAR = 100;

export function dollars(n: number): Cents {
  return Math.round(n * CENTS_PER_DOLLAR);
}

export function toDollars(c: Cents): number {
  return c / CENTS_PER_DOLLAR;
}

/**
 * Format cents as a currency string.
 * Defaults to USD with adaptive compaction for large numbers.
 */
export function formatMoney(
  c: Cents,
  opts: { currency?: string; compact?: boolean; sign?: boolean } = {},
): string {
  const { currency = "USD", compact = false, sign = false } = opts;
  const value = toDollars(c);
  const absValue = Math.abs(value);

  if (compact && absValue >= 1_000_000) {
    return formatCompact(value, currency, sign);
  }

  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: absValue >= 100 ? 0 : 2,
  }).format(value);

  if (sign && value > 0) return `+${formatted}`;
  return formatted;
}

function formatCompact(value: number, currency: string, sign: boolean): string {
  const abs = Math.abs(value);
  const symbol = currency === "USD" ? "$" : "";
  let out: string;
  if (abs >= 1_000_000_000) out = `${(value / 1_000_000_000).toFixed(2)}B`;
  else if (abs >= 1_000_000) out = `${(value / 1_000_000).toFixed(2)}M`;
  else if (abs >= 1_000) out = `${(value / 1_000).toFixed(1)}K`;
  else out = value.toFixed(0);
  const prefix = value < 0 ? "-" : sign && value > 0 ? "+" : "";
  return `${prefix}${symbol}${out.replace(/^-/, "")}`;
}

export function addCents(a: Cents, b: Cents): Cents {
  return a + b;
}

export function subtractCents(a: Cents, b: Cents): Cents {
  return a - b;
}

export function percentOf(c: Cents, pct: number): Cents {
  return Math.round(c * pct);
}
