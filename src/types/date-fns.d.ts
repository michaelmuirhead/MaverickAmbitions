/**
 * Type shim for date-fns 3.x.
 *
 * date-fns 3.x ships its types as `.d.mts` files and declares them via the
 * `exports` field's `import.types` condition. Our `tsconfig.json` uses
 * `moduleResolution: "bundler"`, which correctly resolves `date-fns` itself
 * to `index.d.mts` — but when that `.d.mts` file then does
 * `export * from "./add.js"`, the bundler resolver strips the `.js` extension
 * and looks for `add.d.ts` (not `add.d.mts`), failing to pick up the peer
 * types file. The result is that `import { getHours } from "date-fns"` type-
 * checks as "no exported member getHours" — even though the runtime works
 * fine (esbuild / Vite / tsx all resolve ESM correctly).
 *
 * This shim declares the narrow subset of date-fns functions our code uses,
 * silencing the spurious `tsc --noEmit` errors while the upstream TS 5.6+
 * resolver fix propagates. `skipLibCheck: true` in tsconfig means this
 * ambient module declaration wins over the real `.d.mts` file.
 */

declare module "date-fns" {
  export function addHours(date: Date | number, amount: number): Date;
  export function addDays(date: Date | number, amount: number): Date;
  export function addMinutes(date: Date | number, amount: number): Date;
  export function format(
    date: Date | number,
    formatStr: string,
    options?: Record<string, unknown>,
  ): string;
  export function getDay(date: Date | number): number;
  export function getHours(date: Date | number): number;
  export function getMinutes(date: Date | number): number;
  export function getMonth(date: Date | number): number;
  export function getYear(date: Date | number): number;
  export function getDate(date: Date | number): number;
  export function startOfDay(date: Date | number): Date;
  export function startOfWeek(
    date: Date | number,
    options?: Record<string, unknown>,
  ): Date;
  export function differenceInDays(
    dateLeft: Date | number,
    dateRight: Date | number,
  ): number;
  export function differenceInHours(
    dateLeft: Date | number,
    dateRight: Date | number,
  ): number;
  export function isWeekend(date: Date | number): boolean;
}
