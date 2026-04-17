/**
 * Save-file schema versioning + migrations.
 *
 * Any change to `GameState` that would break older saves goes here as
 * a migration. Keeps saves portable across releases.
 */

import type { GameState } from "@/types/game";

export const CURRENT_SAVE_VERSION = 3;

type MigrationFn = (state: unknown) => unknown;

const MIGRATIONS: Record<number, MigrationFn> = {
  // v1 -> v2: v0.5 macro shocks. Seed empty activeEvents + eventHistory on
  // older saves so the macro event scheduler has fields to read.
  1: (s) => {
    const obj = (s as Record<string, unknown>) ?? {};
    return {
      ...obj,
      version: 2,
      activeEvents: Array.isArray(obj.activeEvents) ? obj.activeEvents : [],
      eventHistory: Array.isArray(obj.eventHistory) ? obj.eventHistory : [],
    };
  },
  // v2 -> v3: v0.5.1 small-business credit. Seed empty businessLoans map.
  2: (s) => {
    const obj = (s as Record<string, unknown>) ?? {};
    return {
      ...obj,
      version: 3,
      businessLoans:
        obj.businessLoans && typeof obj.businessLoans === "object"
          ? obj.businessLoans
          : {},
    };
  },
};

export function migrateSave(raw: unknown): GameState {
  const obj = raw as { version?: number };
  let version = obj.version ?? 0;
  let working: unknown = raw;
  while (version < CURRENT_SAVE_VERSION) {
    const mig = MIGRATIONS[version];
    if (!mig) {
      throw new Error(
        `No migration from save version ${version} to ${CURRENT_SAVE_VERSION}.`,
      );
    }
    working = mig(working);
    version++;
  }
  return working as GameState;
}
