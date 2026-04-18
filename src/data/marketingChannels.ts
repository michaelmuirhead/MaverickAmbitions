/**
 * Marketing channel profiles (v0.10 "Marketing & Levers").
 *
 * Replaces the pre-v0.10 single `marketingWeekly` scalar with six
 * distinct channels. Each channel has a demographic-reach fingerprint
 * (who it reaches best), a saturation curve (how quickly spend stops
 * mattering), and a decay rate (how fast recall drops when you stop
 * spending).
 *
 * The tick math lives in `src/engine/business/marketingChannels.ts`; this
 * file is pure data. Keep economic constants here so tuning is a data
 * change, not a code change.
 *
 * Saturation and lift are calibrated so that:
 *   - $100/wk on a matched channel produces a meaningful but sub-20% lift
 *     after a few weeks of sustained spend
 *   - $1,000/wk approaches (but never reaches) a cap of 1.0 with demographic
 *     match
 *   - Fully aligned campaigns sustain score ≈ 0.6 at 50% of saturation
 *
 * Decay half-life is per-channel. Email has the fastest decay (owned
 * list, but recall drops off once you stop sending); magazines + OOH are
 * slow (residual shelf life).
 */

import type { MarketingChannel, MarketingChannelProfile } from "@/types/game";

import { dollars } from "@/lib/money";

/**
 * Per-channel decay: at 168 ticks/week, a decayPerTick of 0.995 yields a
 * roughly 44% weekly retention — two weeks without spend drops score
 * from 1.0 to ~0.19. decayPerTick = 0.999 yields ~85% weekly retention
 * (magazine-grade "shelf life"). The exact tuning is below.
 */
export const MARKETING_CHANNELS: Record<
  MarketingChannel,
  MarketingChannelProfile
> = {
  radio: {
    id: "radio",
    displayName: "Radio",
    icon: "📻",
    description:
      "Broad-reach local broadcast. Cheap, fast to pick up, fast to fade. Works best for everyday goods and older-skewing markets.",
    ageReach: 0.25, // skews slightly older than average
    incomeReach: -0.15, // skews slightly lower-income
    saturationCentsPerWeek: dollars(800),
    decayPerTick: 0.9955, // ~47% weekly retention
    liftAtHalfSaturation: 0.45,
    minWeeklyCents: dollars(50),
  },
  social: {
    id: "social",
    displayName: "Social",
    icon: "📱",
    description:
      "Paid social & influencer spend. Scales with spend and targets young urban density. Medium decay.",
    ageReach: -0.6, // young-skewed
    incomeReach: 0.0,
    saturationCentsPerWeek: dollars(1_200),
    decayPerTick: 0.9965, // ~55% weekly retention
    liftAtHalfSaturation: 0.55,
    minWeeklyCents: dollars(75),
  },
  tv: {
    id: "tv",
    displayName: "TV",
    icon: "📺",
    description:
      "Cable and local broadcast. Older-skewing, expensive per impression, slow to burn off. Shines in suburbs and wealthy enclaves.",
    ageReach: 0.55, // older-skewed
    incomeReach: 0.2,
    saturationCentsPerWeek: dollars(3_500),
    decayPerTick: 0.9975, // ~66% weekly retention
    liftAtHalfSaturation: 0.5,
    minWeeklyCents: dollars(500),
  },
  magazines: {
    id: "magazines",
    displayName: "Magazines",
    icon: "📖",
    description:
      "Print and niche trade pubs. Affluent-skewing, slow-decay shelf life. Ideal for luxury goods and specialty commercial districts.",
    ageReach: 0.35,
    incomeReach: 0.65, // strongly affluent
    saturationCentsPerWeek: dollars(1_500),
    decayPerTick: 0.998, // ~72% weekly retention
    liftAtHalfSaturation: 0.4,
    minWeeklyCents: dollars(150),
  },
  ooh: {
    id: "ooh",
    displayName: "Out-of-home",
    icon: "🪧",
    description:
      "Billboards, transit posters, bus wraps. Location-bound. Works in high-density corridors and industrial/port belts; slow decay.",
    ageReach: 0.0, // neutral
    incomeReach: 0.1,
    saturationCentsPerWeek: dollars(2_000),
    decayPerTick: 0.998, // ~72% weekly retention
    liftAtHalfSaturation: 0.45,
    minWeeklyCents: dollars(200),
  },
  email: {
    id: "email",
    displayName: "Email / owned",
    icon: "✉️",
    description:
      "Owned list + newsletter. Near-zero marginal cost per send, but recall drops off fast if you stop. Best for repeat-purchase retail and hospitality.",
    ageReach: -0.1,
    incomeReach: 0.25, // slightly affluent (people who check email lists)
    saturationCentsPerWeek: dollars(300),
    decayPerTick: 0.9945, // ~39% weekly retention (fastest decay)
    liftAtHalfSaturation: 0.55,
    minWeeklyCents: dollars(10),
  },
};

/** Ordered list for UI rendering and smoke tests. */
export const MARKETING_CHANNEL_IDS: MarketingChannel[] = [
  "radio",
  "social",
  "tv",
  "magazines",
  "ooh",
  "email",
];

/**
 * Convenience: zero-spend channel map, used as initial state and as the
 * reset shape for voluntary-close.
 */
export function zeroChannelMap<T extends number>(zero: T) {
  return {
    radio: zero,
    social: zero,
    tv: zero,
    magazines: zero,
    ooh: zero,
    email: zero,
  } as Record<MarketingChannel, T>;
}
