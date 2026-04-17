/**
 * Tunable economy constants. Change these to rebalance without touching logic.
 */

export const ECONOMY = {
  // --- Macro ---
  /** In-game hours for a full macro cycle (5–9 in-game years). */
  MACRO_CYCLE_HOURS_MIN: 5 * 365 * 24,
  MACRO_CYCLE_HOURS_MAX: 9 * 365 * 24,

  /** Rate bounds on the nominal annual interest rate. */
  INTEREST_RATE_MIN: 0.03,
  INTEREST_RATE_MAX: 0.09,

  /** Consumer wallet swing from trough to peak. */
  CONSUMER_WALLET_MIN: 0.85,
  CONSUMER_WALLET_MAX: 1.15,

  // --- Retail / foot traffic ---
  /** Typical daytime foot traffic for a mid-quality neighborhood per hour. */
  BASE_HOURLY_TRAFFIC: 120,
  /** Fraction of foot traffic that actually enters a given store (pre-mods). */
  BASE_VISIT_RATE: 0.06,
  /** Baseline conversion inside the store. */
  BASE_CONVERSION: 0.45,

  // --- Rent ---
  /** Baseline monthly rent for a small retail lease (in cents). */
  BASE_RENT_MONTHLY_CENTS: 350000, // $3,500

  // --- Labor ---
  /** Baseline hourly wage for a retail clerk (in cents). */
  BASE_HOURLY_WAGE_CENTS: 1800, // $18/hr

  // --- Tax (first-pass, one jurisdiction) ---
  INCOME_TAX_BRACKETS: [
    { upToCents: 1_200_000, rate: 0.1 }, // up to $12k — 10%
    { upToCents: 5_000_000, rate: 0.18 }, // up to $50k — 18%
    { upToCents: 25_000_000, rate: 0.28 }, // up to $250k — 28%
    { upToCents: Infinity, rate: 0.37 },
  ],
  CORP_TAX_FLAT_RATE: 0.21,

  // --- Risk ---
  /** Baseline chance of a random event per business per day. */
  DAILY_EVENT_CHANCE: 0.04,
};
