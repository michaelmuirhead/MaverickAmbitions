/**
 * Seedable RNG (mulberry32). Using a seeded RNG means:
 *  - saves are reproducible (re-playing from a save with the same actions
 *    gives the same outcomes)
 *  - rivals can be simulated deterministically for UI previews
 *  - unit tests are stable
 *
 * Do NOT use Math.random() anywhere in the engine.
 */

export interface RNG {
  /** Returns a float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number;
  /** Float in [min, max). */
  nextFloat(min: number, max: number): number;
  /** Returns true with probability p. */
  chance(p: number): boolean;
  /** Pick an element. */
  pick<T>(arr: readonly T[]): T;
  /** Weighted pick given parallel weights array. */
  pickWeighted<T>(arr: readonly T[], weights: readonly number[]): T;
  /** Fresh child RNG with deterministic derivation from a string. */
  child(namespace: string): RNG;
  /** Expose internal state for serialization. */
  snapshot(): number;
  restore(state: number): void;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class RNGImpl implements RNG {
  private fn: () => number;
  private seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.fn = mulberry32(this.seed);
  }

  next(): number {
    return this.fn();
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("pick on empty array");
    return arr[Math.floor(this.next() * arr.length)]!;
  }

  pickWeighted<T>(arr: readonly T[], weights: readonly number[]): T {
    if (arr.length === 0 || arr.length !== weights.length) {
      throw new Error("pickWeighted: array/weights length mismatch");
    }
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return arr[i]!;
    }
    return arr[arr.length - 1]!;
  }

  child(namespace: string): RNG {
    return new RNGImpl((this.seed ^ hashString(namespace)) >>> 0);
  }

  snapshot(): number {
    // The current internal counter is captured by re-hashing; for a strict
    // reproduction you'd store fn's closure state. For MVP we snapshot the
    // initial seed only and re-create forward.
    return this.seed;
  }

  restore(state: number): void {
    this.seed = state >>> 0;
    this.fn = mulberry32(this.seed);
  }
}

export function createRng(seed: string | number): RNG {
  const seedNum = typeof seed === "number" ? seed : hashString(seed);
  return new RNGImpl(seedNum);
}
