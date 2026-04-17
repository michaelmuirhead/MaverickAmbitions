# Maverick Ambitions — Game Design Document

A deep, generational business simulation. The player starts with a single corner store and builds an empire across industries, eventually buying sports teams, running cities, and passing the dynasty to their heirs. Designed iPhone-first, adaptive to iPad and Desktop.

---

## 1. Design pillars

1. **Depth without grind.** Every decision (price, hire, loan, acquisition) should matter and feed into a legible financial model. Nothing is cosmetic.
2. **Generational stakes.** You are not a single character. You are a lineage. Your choices echo forward — and your heirs inherit both wealth and baggage.
3. **Rivals that punch back.** AI rivals play the same game you do on the same economy. They hire, acquire, raise capital, and will take territory if you blink.
4. **Scales from store to empire.** Starting systems (inventory, pricing, staff) are the same systems that, extended, run a studio, an oilfield, or a state government.
5. **iPhone-first, but not a phone app stretched.** iPad and Desktop get real layouts — multi-pane, side-nav, dashboards — not a phone column centered on a big screen.

---

## 2. Core loop

**Minute-to-minute (one tick = one in-game hour):**
- Monitor key businesses (foot traffic, cash flow, staff morale)
- Respond to events (break-in, price war, employee quits, family event)
- Adjust operations (pricing, inventory, marketing spend)

**Day-to-day (24 ticks):**
- Close books, pay wages, restock inventory
- Personal actions (spouse time, kids, hobby, sleep)
- Review rivals' public moves (acquisitions, expansions)

**Week-to-week:**
- Weekly P&L, cash flow, balance sheet snapshot
- Strategic moves (open new location, hire manager, take loan, launch product)

**Quarter / Year:**
- Tax filing, audit risk
- Annual report vs. rivals (market share, net worth)
- Aging: player and family progress; milestones (marriage, birth, graduation)
- Macroeconomic regime shifts (boom, recession, interest rate change)

**Generation:**
- Player ages, eventually retires or dies
- Heirs inherit net worth, businesses, reputation, and rivalries
- New starting conditions for the next generation shaped by parent's choices

---

## 3. Time model

- Base tick: **1 in-game hour** in ~**2 real seconds** (configurable 1x/2x/4x/8x).
- In-game calendar starts Monday, January 5, 2026.
- Players can pause freely; time advance is deterministic against a seeded RNG so re-loading gives the same outcomes given the same actions (important for fairness vs. AI).

**Scheduling:**
- `Scheduler` keeps a min-heap of `ScheduledEvent { tickDue, kind, payload }`.
- Per tick: run scheduled events → run business operations → run rivals → run events.

---

## 4. Economy model

The economy is **not** a black box that emits random numbers. It's a lightweight simulation with real levers:

### 4.1 Goods & services
Each tradeable item has:
- `baseCost` — supplier price
- `basePrice` — retail reference price
- `demandCurve` — price-elasticity (linear + noise)
- `supplyShocks` — random events modify supplier cost
- `categoryTrend` — slow macro drift (tobacco down, energy drinks up, etc.)

### 4.2 Market
For each market (neighborhood):
- `footTraffic` derived from population, time-of-day, and events
- `competitiveDensity` from rival stores operating there
- `consumerWallet` — median disposable income, affected by macro cycle

A store's weekly revenue is approximately:

```
revenue = sum_over_items(
  clamp(footTraffic * visitRate * conversionRate * avgBasket, 0, inf)
)
visitRate = marketingScore * locationQuality / competitiveDensity
conversionRate = priceAttractiveness * stockAvailability * staffService
```

All factors are bounded, cached per tick, and exposed to the UI so the player can see **why** revenue moved.

### 4.3 Macro cycles
A single scalar `macroPhase` ∈ [0, 1] rotating ~5–9 in-game years per cycle (randomized) drives:
- consumer wallet multiplier (0.85x at trough, 1.15x at peak)
- interest rate (3–9%)
- real estate price multiplier

### 4.3a Macro shocks (v0.5)
Ten timed shocks live in `data/macroEvents.ts` and fire from a weighted table on the weekly roll (Monday 00:00). They are the *other* half of the macro layer — baseline cycles are smooth, shocks are punctuated.

**Categories** — `rates`, `wallet`, `realestate`, `hospitality`, `cogs`, `labor`. Each shock has a severity (`mild` / `strong`), tone (`positive` / `negative` / `mixed`), duration, and a `pulse` payload.

**Pulse composition.** Active shocks compose additively on interest rate and multiplicatively on wallet / real-estate / labor, all clamped to safe ranges by `applyMacroPulses`. A separate `getPulseBundle` returns shock-only knobs that business modules opt into directly (`cogsMultiplier`, `liquorLicenseFeeMultiplier`, `trafficMultiplierByType`). Baseline macro is advanced first; shocks then modify the *output* — so rivals and business modules see the post-pulse world without the baseline cycle itself being perturbed.

**Guardrails.**
- `WEEKLY_ROLL_CHANCE = 0.08` (roughly 4 events/yr on natural play).
- `MAX_SIMULTANEOUS_EVENTS = 3` — the weekly roll skips if already at cap.
- `EVENT_HISTORY_CAP = 32` retained for cooldown lookup.
- Each def has its own `cooldownTicks` so the same shock doesn't stack back-to-back.
- `expireFinishedEvents` runs at the top of every tick, freeing cap slots and emitting `macro_shock_end` events.

**Rival reactions.** `getRivalEventBias(rival, activeEvents)` produces an additive/multiplicative bias bundle that `enumerateMoves` consumes alongside normal scoring. Each personality has its own playbook per category — e.g. a `tycoon` boosts `propertyBuyBoost` +30 under `housing_downturn`; a `predator` biases new opens toward cafes (×1.25) and away from bars (×0.85) during `liquor_tax_hike`. The reaction matrix is codified in `engine/ai/rivalReactions.ts` and snapshot-tested in `scripts/smoke-events.ts`.

**Player surfacing.** The dashboard renders a banner strip for every active shock via `getEventBanners`. A debug console on the settings page exposes `forceActivate` for deterministic repros.

Older shock kinds (pandemic, oil crisis, tech boom) from the original design brief are deferred to post-v0.5 until we have industries that would make them bite — they become trivial to add as new entries in the catalog.

### 4.4 Finance
- **Cash** is tracked in cents to avoid float drift.
- **Loans** have rate, term, amortization schedule; missed payments damage credit.
- **Taxes** — simple progressive income + corporate bracket per jurisdiction. Stored in `data/taxBrackets.ts` so future jurisdictions plug in.
- **Credit score** (300–850) derived from debt-to-income, payment history, business age.

---

## 5. Business system

Businesses are **pluggable**. A `BusinessType` declares:
- `id` (`"corner_store"`, `"cafe"`, `"studio"`, `"oilfield"`, `"sports_team"`, `"city"`, ...)
- schema of operations (inventory? staff roles? menu? roster?)
- tick behavior (`onHour`, `onDay`, `onWeek`)
- KPIs exposed to the UI
- upgrade tree and unlock requirements

The corner store MVP has:
- **Inventory** of ~20 SKUs (snacks, drinks, tobacco, lottery, essentials)
- **Staff**: 0–5 clerks, each with wage/skill/morale
- **Location**: rent, quality, foot traffic
- **Marketing**: local flyer, social, loyalty program
- **Risks**: theft, health inspection, price war

The same interfaces will later carry: gaming studio (projects instead of SKUs, devs instead of clerks), oil/gas (wells, crews), real estate (units, tenants), and sports teams (roster, season schedule).

See `src/engine/business/registry.ts`.

---

## 6. Player & personal life

Character sheet:
- `age`, `health`, `energy`, `reputation`
- `skills` — management, negotiation, finance, charisma, tech, etc. (0–100)
- `needs` — sleep, social, family, leisure, status
- `relationships` — map of NPC → affinity

Personal actions compete with business actions for the same 24-hour day. You can grind and burn out, or delegate and build culture. Delegation quality depends on your management skill and the reputation you've built with employees.

---

## 7. Generational & family system

- **Marriage**: optional. Spouse has own skills & stats; can become COO or drain finances in divorce.
- **Children**: 0–N. Each child rolls traits influenced by parents plus random variance. Upbringing choices (private school, internships, travel) shape adult stats.
- **Aging**: tick-driven; milestones (18, 22, 30, 65) trigger life events.
- **Succession**: when the player retires/dies:
  - Heir is chosen by the player (or default by eldest) via will
  - Inheritance tax applies based on jurisdiction
  - Heir's starting stats = upbringing outcome + inherited reputation
  - Rivalries, debts, and ongoing events persist into the new generation
- **Dynasty score**: cumulative net worth, philanthropy, influence across generations. This is the real win condition.

---

## 8. AI rivals

Rivals are **first-class players**, not window dressing.

Each rival has:
- `personality`: archetypes like `Predator` (aggressive acquirer), `Tycoon` (diversifier), `Operator` (margin optimizer), `Disruptor` (low-price war), `Politician` (influence / regulation plays)
- `riskAppetite`, `timeHorizon`, `ethics` (affects legal/illegal play)
- `portfolio` — their businesses, fully simulated against the same economy
- `memory` — they remember what you did to them

Turn logic (evaluated weekly):
1. Compute own financial state and opportunities in the market
2. Score candidate moves with a utility function weighted by personality
3. Execute top move with randomness bounded by difficulty

Difficulty scales 1–5:
1. **Intern** — rarely expands, passive.
2. **Manager** — reacts to you.
3. **Operator** — proactive, efficient.
4. **Tycoon** — aggressive, well-capitalized.
5. **Kingmaker** — coordinated with other rivals, political capital, can absolutely ruin you.

Rivals play by the **same rules** as the player — their P&L is real, they can go bankrupt, they can be acquired.

---

## 9. Save / load

- State is a single serializable object.
- Versioned schema with migrations (`v1 -> v2 -> ...`) so save files survive updates.
- Autosave every in-game day; manual save to named slot.
- MVP storage: browser `localStorage`. Future: Supabase/Postgres for cloud save; not needed for Vercel-only scaffold.

---

## 10. UI architecture

### Responsive strategy

The app has **three distinct layouts**, not one layout that stretches:

| Width    | Layout          | Nav              | Columns           |
| -------- | --------------- | ---------------- | ----------------- |
| <768px   | iPhone          | Bottom tab bar   | 1                 |
| 768–1279 | iPad            | Left side nav    | 2 (detail + side) |
| ≥1280px  | Desktop         | Left nav + right | 3 (workspace)     |

A single `ResponsiveShell` reads the current breakpoint and renders the right chrome. Page content is written in **content blocks** that compose into 1/2/3-column arrangements automatically — so we never force iPhone columns onto an iPad.

### Primary screens
- **Dashboard** — net worth, cash, rival delta, daily P&L, active events
- **Business** — per-business operations (corner store for MVP)
- **Market** — neighborhoods, competition, macro indicators
- **Rivals** — leaderboard, intel, recent moves
- **Family** — character sheet, spouse, children, dynasty tree
- **Settings** — time speed, difficulty, save/load

---

## 11. Tech stack

- **Next.js 14** App Router + TypeScript, deployed to **Vercel**
- **Tailwind** for styling
- **Zustand** + **Immer** for state (client-side, works offline, no server required)
- **date-fns** for time math
- **nanoid** for stable IDs
- All game logic is pure TypeScript and unit-testable independent of React.

---

## 12. Folder layout

```
src/
├── app/                  # Next routes (App Router)
│   └── (game)/*          # Authenticated game routes
├── components/
│   ├── layout/           # Responsive shell, nav, topbar
│   ├── ui/               # Primitives (Card, Button, StatTile)
│   └── game/             # Game-specific widgets
├── engine/               # Pure game logic. NO React imports.
│   ├── economy/
│   ├── business/
│   ├── player/
│   ├── family/
│   ├── ai/
│   ├── events/
│   └── save/
├── state/                # Zustand store + slices
├── data/                 # Static data (SKUs, names, tax brackets)
├── hooks/                # React hooks bridging engine ↔ UI
├── lib/                  # Pure utilities (RNG, money, date)
└── types/                # Shared types
```

**Golden rule:** the `engine/` folder must never import from `components/` or `app/`. This keeps game logic testable and portable (e.g. server-side AI simulation later).

---

## 13. Roadmap

> Version numbers reshuffled during implementation. "Empire" (sports/cities) moved out past v0.6 to let the economic substrate mature first; "Real estate" earned its own milestone because the mortgage + property system turned out to be load-bearing for rival behavior.

### v0.1 — MVP scaffold ✅
- Responsive shell + 6 routes wired
- Time tick + speed controls
- Corner store end-to-end: inventory, pricing, staff, daily P&L
- One AI rival running the same systems
- Local save/load
- Character with basic needs

### v0.2 — Family ✅
- Marriage, children, aging, succession
- Dynasty tree view

### v0.3 — Real estate ✅
- Property listings per market; mortgages with credit-banded rates
- Monthly settlement: P&I, maintenance, absentee rent, revaluation
- Rivals buy/hold/sell properties against the same economy

### v0.4 — Hospitality triad ✅
- Cafe, bar, restaurant modules with CSAT flywheel + halo
- Quality tiers, happy hour, menu programs, tipped staff
- Liquor licenses, peak curves, hospitality-specific KPIs

### v0.5 — Macro shocks ✅
- 10-event catalog across rates/wallet/realestate/hospitality/cogs/labor
- Weekly roll → pulse composition → expiry pipeline (max 3 concurrent)
- Rival reaction matrix per personality per category
- Banner UI on dashboard + force-activate debug console
- Business modules read `getPulseBundle` for COGS / traffic / license bites

### v0.6 — Industries (next)
- Tech startup module (projects instead of SKUs, devs instead of clerks)
- Cross-business holding-company view
- Acquisition / divestiture mechanics (buy a rival's shop, be bought out)

### v0.7+ — Empire
- Sports teams (roster + season), cities (tax base, elections), political influence
- Media & reputation system, lawsuits, scandals
- 3–5 rivals with coordinated behavior + memory of player moves

---

## 14. Balance notes

Economy constants live in `src/engine/economy/constants.ts` so they can be tuned without touching logic. First-pass targets for a corner store:

- Break-even at ~$4,200/wk revenue with 1 clerk + median rent
- "Comfortable" at ~$7,500/wk revenue, ~22% net margin
- Capital needed to open: ~$35,000 (lease, fixtures, initial inventory)
- First-year bankruptcy rate for greedy/neglectful play: ~30%

These numbers ground the fantasy in real small-retail economics.
