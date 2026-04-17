/**
 * Name pools for the default region. Will extend later with
 * region-specific locales.
 */

import type { RNG } from "@/lib/rng";

const FIRST_NAMES = [
  "Alex", "Jordan", "Sam", "Taylor", "Morgan", "Riley", "Casey",
  "Maya", "Aiden", "Zoe", "Noah", "Liam", "Ava", "Mia", "Elijah",
  "Sofia", "Lucas", "Ethan", "Harper", "Aria", "Carter", "Mason",
  "Isla", "Chloe", "Ezra", "Ivy", "Kai", "Leo", "Nora", "Owen",
  "Quinn", "Sienna", "Theo", "Willa", "Xavier", "Yara", "Zane",
];

const LAST_NAMES = [
  "Muirhead", "Castillo", "Park", "Nguyen", "Okafor", "Patel", "Kim",
  "Ivanov", "Haddad", "Volkov", "Silva", "Yamamoto", "Brennan",
  "Chaudhry", "Mendez", "Kovač", "Laurent", "Abad", "Tanaka",
  "Martinelli", "Rasmussen", "Bernard", "Gill", "Haider", "Santos",
];

export function pickName(rng: RNG): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

export function pickFirstName(rng: RNG): string {
  return rng.pick(FIRST_NAMES);
}

export function pickLastName(rng: RNG): string {
  return rng.pick(LAST_NAMES);
}
