# Maverick Ambitions — Game Design Document

A deep, generational business simulation. The player starts with a single corner store and builds an empire across industries, eventually buying sports teams, running cities, and passing the dynasty to their heirs. Designed iPhone-first, adaptive to iPad and Desktop.

**Setting.** v0.8.0 ships with a single playable Region: **Maverick County, NY** — a fictional booming county on the outskirts of New York City. 46 neighborhoods span a mini-Manhattan downtown, Westchester/Nassau-flavored suburbs, a Long Island-adjacent coastal strip, Catskills-adjacent upstate hamlets, and a NY Harbor-style industrial / port belt. The Region is the forward-looking unit the map grows by — Phase 2 adds NYC proper, Long Island, and New Jersey; Phase 3 opens the rest of the country, where region-level mechanics (sports-team ownership, political office) come online. See §13 for the full roadmap.

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

As of v0.8.0 the registry carries **22 business types** across 6 categories (see `src/engine/business/registry.ts`):

- **Food & Hospitality (7)** — `corner_store`, `cafe`, `bar`, `restaurant`, `pizza_shop`, `food_truck`, `nightclub`.
- **Retail (8)** — `bookstore`, `electronics_store`, `florist`, `supermarket`, `jewelry_store`, `clothing_retail`, `suit_store`, `furniture_store`. All 8 are built on a shared retail engine (`retailBase.ts`) parameterized with SKU lists, elasticity coefficients, restock cadence, and staff roster — the concrete module files are thin configs.
- **Entertainment (2)** — `cinema` (multi-screen, 28-day film lifetime decay, concession attach rate, streaming pressure), `movie_studio` (long-cycle productions, 104-week streaming tail, `box_office` ledger).
- **Services (2)** — `hospital_clinic` (24/7, clinician-ratio throttling, copay immediate + delayed insurance billing, malpractice risk), `real_estate_firm` (flip + manage portfolio, monthly rent collection, appreciation drift, `flip_gain` / `property_management_fee` ledgers).
- **Project-based (3)** — `tech_startup`, `gaming_studio`, `construction` — all share `projectBase.ts`. Configs differ by project-duration range, budget range, burn ratio, concurrency cap, and residuals. Tech startup layers a VC raise overlay on `onWeek`; gaming studio carries a 52-week royalty tail; construction has no residual tail.
- **Heavy Industry (2)** — `oil_gas` (per-well production + weekly decline, spot-price random walk, drilling capex with hit/dry-hole outcomes), `military_tech` (uses `projectBase` with `gov_contract` billing + `rd_spend` cost ledgers, 2 concurrent programs, 26–52 week durations).

Ledger categories added in v0.8: `cover_charge`, `project_billing`, `project_cost`, `vc_proceeds`, `royalties`, `box_office`, `concessions`, `insurance_billing`, `malpractice_settlement`, `property_management_fee`, `flip_gain`, `commodity_sale`, `drilling_capex`, `gov_contract`, `rd_spend`. Grand-strategy dashboards can now cleanly separate private vs. public revenue, one-shot vs. recurring income, and operating expense vs. capital expenditure.

The registry also exports `BUSINESS_TYPE_CATEGORIES` for UI grouping — the MarketPage button grid renders category headers instead of a flat list so 22 types stay scannable.

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

- **Vite 5** + **React 18** + TypeScript, deployed as a static bundle to any host
- **React Router 6** using `createHashRouter` — `#/dashboard` deep links work on GitHub Pages / S3 / nginx with zero rewrite rules
- **Tailwind** for styling (PostCSS pipeline, untouched by the Vite migration)
- **Zustand** + **Immer** for state (client-side, works offline, no server required)
- **date-fns** for time math
- **nanoid** for stable IDs
- All game logic is pure TypeScript and unit-testable independent of React.

> Historical note: v0.1 through v0.5.1 ran on Next 14 App Router. In v0.6 we moved to Vite specifically for deploy simplicity — the game has no server-side anything (no SSR, no API routes, no middleware), so paying the Next runtime cost bought us nothing, while HashRouter + static `dist/` works on any host.

---

## 12. Folder layout

```
src/
├── App.tsx               # Route table (createHashRouter + RouterProvider)
├── main.tsx              # Vite entry (createRoot into #root)
├── styles.css            # Tailwind directives + iOS safe-area
├── routes/               # One file per page (DashboardPage, BusinessPage, …)
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

**Golden rule:** the `engine/` folder must never import from `components/` or `routes/`. This keeps game logic testable and portable (e.g. server-side AI simulation later).

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

### v0.5.1 — Small-business credit ✅
- **Problem:** Starter cash is $15K; cheapest business costs $35K. Players soft-locked before the first tick.
- **Fix:** SBA 7(a)-style business loans mirroring the mortgage infrastructure.
- Credit-banded loan-to-cost caps: 85% (exceptional) / 80% (good) / 75% (fair) / 70% (subprime 660+) / 0% (deep subprime).
- Base SBA rate = macro interest rate + 2.5pp; credit spread adds 0–4pp.
- 60-month amortization, personally guaranteed (debt survives business closure).
- Payments draw business-cash-first, personal-fallback; missed payment = credit ding (−35).
- Market UI renders Finance button when cash short but credit qualifies.
- Finance page shows "Business debt" tile + per-loan cards (rate, term, balance, paid-down %).
- Save format bumped v2→v3 with zero-migration default (`businessLoans: {}`).
- Smoke test: `npm run smoke:business-loans`.

### v0.6 — Vite migration, hardened ✅
- **Problem:** Next 14 App Router + "use client" pragmas + Vercel-assumed deploy = friction for a pure client-side app with no SSR/API needs. The initial Vite cut also carried forward two subtle bugs: business tick modules mutated their frozen input state (clock-freeze on live after buying a store), and `useGameTick` re-subscribed its interval on every tick.
- **Fix — migration:** Vite + React Router (HashRouter), keeping every line of engine/state/components code intact.
- New entry surface: `index.html` → `src/main.tsx` → `src/App.tsx` (route table) → `src/routes/*`.
- `createHashRouter` chosen over `createBrowserRouter` for deploy simplicity — any static host serves `#/dashboard` deep links without URL-rewrite rules.
- Vite config uses `base: "./"` so builds work from subpaths (GitHub Pages, nested CDN mounts).
- Dropped: `next`, `next/link`, `next/navigation`, `useRouter`, `usePathname`, `Route` type, `src/app/`, `next.config.mjs`, `next-env.d.ts`.
- tsconfig switched `jsx: "preserve"` → `"react-jsx"`; dropped the `next` TS plugin.
- All 7 game routes + home + new-game ported 1:1; nav components swapped to `Link from react-router-dom` + `useLocation().pathname`.
- **Fix — engine purity:** The retail / cafe / bar / restaurant tick modules all share a single `getState(biz)` helper. In v0.6 that helper deep-clones `biz.state` (`structuredClone`) so the downstream in-place mutations land on a fresh tree. The returned `Business` packages the mutated clone back up. Result: `stepTick` is now truly pure, and immer's default deep-freeze is no longer a landmine. The `setAutoFreeze(false)` band-aid that was added to silence the mutation errors has been removed.
- **Fix — `useGameTick`:** Removed the full `game` reference from both effect dep arrays. The interval effect now watches only `hasGame`, `speed`, `intervalMs`, and `tick`; the autosave effect watches only `tickCount` / `hasGame` / `autoSave`. Previously the interval was being torn down and rebuilt on every tick, which raced with the next scheduled callback.
- **Fix — `"use client"` cleanup:** Stripped the leftover Next.js pragma from 11 files (selectors, store, hooks, components, routes). No behavioral change; just noise removal.
- **Regression canary:** `npm run smoke:purchase-tick` runs 48 ticks with an owned store against a fully deep-frozen state and asserts wages accrue, revenue is booked, and the input state reference is untouched. Wired into the main `smoke` script ahead of the other suites.

### v0.7 — Player agency ✅
The simulation was deep; the *UI surface* was thin. A player could buy a business but couldn't price a SKU, could see a staff line but couldn't hire or fire, could see a marketing score but couldn't adjust spend from the screen they were on. v0.7 closes that gap end-to-end before any new industries.
- **Business detail page.** `/business/:id` with Overview / Inventory / Staff / Marketing / Finance tabs wired to the existing `patchBusinessState` action. Entry point is a compact summary card on `/business` (now a list that links into each detail page) and a post-purchase redirect from Market that navigates straight to the newly-opened business so the player can set pricing / staff before the first tick rolls.
- **Per-SKU pricing.** 5% slider around `referencePrice` (range `[-30%, +50%]` — enough headroom to test gouging without collapsing elasticity to the 0.2 floor). Live preview shows unit margin (`price − cost`) and the `priceAttractiveness` multiplier color-coded emerald / neutral / loss.
- **Hire / fire / wage controls.** StaffTab normalizes the four heterogeneous staff shapes (corner store clerks use `skill`, cafe / bar / restaurant crews use `craft`) behind a `RosterView` abstraction. Applicant pool is deterministic (`createRng(\`${biz.id}:applicants:${nonce}\`)`). Firing dings remaining crew morale by 8; above-band wages (>110% of `ECONOMY.BASE_HOURLY_WAGE_CENTS`) give +4 morale to the whole crew; ±$1/hr wage adjustments shift morale proportionally.
- **Marketing budget UI.** $0–$2,000/wk slider in $50 steps with quick-preset buttons and an 8-week forecast bar chart computed from the live per-type decay formula (`score_{t+1} = score_t × decayMul + min(1, spend/decayRef) × (1 − decayMul)` — `decayRef = $400` for corner stores, `$500` for hospitality; `decayMul = 0.6` / `0.65`).
- **First-time tutorial overlay.** Six-step coach mark — pick a market → open a business → advance time → watch weekly profit → open the detail page → build the dynasty. Seen flag lives in `localStorage` (`ma:tutorial:v0.7`) so game state stays pure. Replay entry in Settings.
- **Events feed upgrade.** Events are grouped by `kind` (Business / Macro / Rivals / Personal / Family / Audit / Milestones) with filter pills, a "Major only" severity toggle (derived from `|cashDelta| ≥ $500` or `|reputationDelta| ≥ 3`), per-event dismiss, and a per-group "Dismiss all" batch action.
- **Regression:** Full smoke suite (`purchase-tick`, `events`, `hospitality`, `cafe`, `real-estate`, `business-loans`) green. Vite production build: 405KB JS / 21KB CSS.

### v0.7.1 — Expanded market roster ✅
The MVP shipped with four neighborhoods in a single virtual city. With per-SKU pricing, hiring, and marketing now playable, the map itself was the bottleneck — four markets couldn't showcase the macro/halo/elasticity systems the rest of the game had grown into.
- **4 → 22 markets**, organized into five archetype bands so each plays differently:
  - **Central city (4)** — the original `m_downtown` / `m_riverside` / `m_oak_hills` / `m_southside`. IDs preserved; v0.1–v0.7 saves hydrate unchanged.
  - **Greater metro urban (8)** — Midtown (dense residential), Warehouse District (gentrifying), University Heights (student), Harborview (waterfront tourism), Silverlake (tech professionals), Old Town (historic), Arts District (creative gentrifier), Little Portugal (ethnic enclave).
  - **Suburbs (5)** — Cedar Park (middle-class family), Willow Creek (master-planned), Pine Ridge (gated enclave), Elmwood (aging inner-ring), Briar Glen (upper-middle).
  - **Outlying / rural (3)** — Meadowbrook (exurban), Fort Hayward (military-adjacent), Junction Town (highway-exit small town).
  - **Specialty commercial (2)** — Tech Park (corporate campus), Medical District (hospital/med-office).
- **Coverage on the three market axes:**
  - Population: 6K (Junction Town) → 68K (Midtown).
  - Median income: $32K (University Heights) → $145K (Pine Ridge).
  - Desirability: 0.35 (Junction Town) → 0.95 (Pine Ridge).
- **No engine changes.** Same `Market` shape, same `generatePropertiesForMarket` call per market, same rival/hospitality halo logic. The MarketPage grid and every downstream selector already iterate `game.markets`, so the UI absorbed the expansion with zero changes.
- **Save compatibility.** Bumped save schema v3 → v4 with an additive migration in `src/engine/save/schema.ts`. Existing saves get the 18 new markets merged in with fresh property inventories generated via `generatePropertiesForMarket`. Original markets (IDs + businessIds + property listings) are preserved untouched. Players who load a v0.7 save in v0.7.1 see all 22 neighborhoods on Markets without losing any of their empire.

### v0.7.2 — Region-scale market roster ✅
v0.7.1 took the map from city to metro. v0.7.2 takes it from metro to region — enough neighborhoods that the same business type can legitimately live in fundamentally different economies, and that new-game replays feel non-identical on the map alone.
- **22 → 46 markets**, organized into seven archetype bands. Every band from v0.7.1 got depth, and two new tiers were added to reach economies the earlier roster couldn't express:
  - **Central city (4)** — `m_downtown` / `m_riverside` / `m_oak_hills` / `m_southside`. IDs preserved since v0.1; all older saves hydrate unchanged.
  - **Greater metro urban (12)** — v0.7.1's eight plus Chinatown (dense ethnic district, loyal cash-heavy customers), Garment District (wholesale/showroom), Theater District (nightlife-skewed), and Financial District (explosive weekday lunch, dead weekends).
  - **Suburbs (10)** — v0.7.1's five plus Maple Grove (generic volume play), Hillcrest (hillside upper-middle), Fairview Heights (older lower-middle strip-mall belt), Tanglewood (understated old-money), and Summit Ridge (new-money luxury).
  - **Outlying / rural (8)** — v0.7.1's three plus Cypress Falls (summer-tourist lake town), Stonebrook (horse country), Copper Valley (declining mining town), Willow Bend (agricultural, the smallest market at 4.2K), and Pineview (retirement community).
  - **Specialty commercial (5)** — v0.7.1's Tech Park and Medical District plus Airport Commons (transient 24/7 demand), Convention Plaza (event-driven spikes), and Campus Commons (university-adjacent).
  - **Coastal / resort (4, NEW)** — Seacliff (high-end bluffs), Marlin Harbor (working fishing village tipping to tourism), Sandy Point (mass-market beach town), Bayshore Marina (yacht/marina, $142K median).
  - **Industrial / port (3, NEW)** — Rust Belt (declining heavy industry), Harbor Works (active container port), Rail Yard (freight/logistics hub).
- **Coverage on the three market axes widened on every edge:**
  - Population: 4.2K (Willow Bend) → 68K (Midtown).
  - Median income: $32K (University Heights) → $145K (Pine Ridge).
  - Desirability: 0.30 (Copper Valley) → 0.95 (Pine Ridge).
- **No engine changes.** Same `Market` shape, same `generatePropertiesForMarket` seed, same rival/hospitality halo and macro-shock multipliers. The MarketPage grid, rival scoring, and every downstream selector already iterated `game.markets`, so the UI absorbed the expansion with zero source changes outside `markets.ts`.
- **Save compatibility.** Bumped save schema v4 → v5 with an additive migration in `src/engine/save/schema.ts` — structurally identical to the v3 → v4 migration, which is the shape this kind of purely-additive market growth wants. Existing saves get the 24 new markets merged in with fresh property inventories; original markets (IDs, `businessIds`, property listings, rival occupants) are preserved untouched. Players loading a v0.7.1 save in v0.7.2 see all 46 neighborhoods on Markets without losing any of their empire.

### v0.7.3 — Maverick County, NY setting + Region model ✅
v0.7.2 delivered 46 neighborhoods but left them in a generic, nameless metro. v0.7.3 gives the map an identity — **Maverick County, NY**, a fictional booming county on the outskirts of New York City — and introduces the data model needed to grow the map outward in later versions without refactoring.
- **Neighborhood flavor.** Every one of the 46 markets got a 1–2 sentence description written to evoke real NY-metro texture. Downtown became a "glass-and-brownstone district modeled on lower Manhattan"; Oak Hills became "old-money Tudors and Colonials, the kind of zip code Westchester realtors quote in full"; Seacliff, Marlin Harbor, Sandy Point, and Bayshore Marina read as Long Island / Jersey Shore-adjacent. Southside reads as a working-class "south of the tracks" district with bodegas and two-fare zones. The Industrial/Port tier became a working harbor + rail-freight belt. The Rural tier evokes upstate (Cypress Falls as a Catskills-adjacent summer town, Copper Valley as a declining mining town).
- **MarketPage surfacing.** The grid header now leads with the region name ("Maverick County, NY") and tagline; every neighborhood card surfaces its description above the population / income / desirability stats. Graceful fallback to the live `STARTER_MARKETS` description for v0.7.2 saves that were persisted without a `description` field.
- **Setting copy in UI.** HomePage splash now carries the setting line. NewGamePage intro reads "You are 24, newly arrived in Maverick County, NY — a booming county on the outskirts of New York City." The Tutorial gained a new step 1 ("Welcome to Maverick County.") introducing the county; the tutorial storage key bumped to `ma:tutorial:v0.7.3` so returning players see it once. SettingsPage "About" card now names the setting and the version.
- **Region data model.** A new `Region` type ships in `src/types/game.ts` with `{ id, name, country, tagline, summary, marketIds, active }`. `GameState` now carries a `regions: Record<Id, Region>` map, and every `Market` now has a required `regionId`. `src/data/regions.ts` exports the single launch region (`r_maverick_county_ny`) with all 46 market IDs listed in its `marketIds` array. The architecture is deliberately thin — the whole point is that Phase 2 and Phase 3 become data additions in `regions.ts`, not a refactor.
- **Save compatibility.** Bumped save schema v5 → v6 with a three-step additive migration:
  1. Back-fills `regionId: "r_maverick_county_ny"` on every existing `Market` record.
  2. Additive merge of any new `STARTER_MARKETS` entries (identity op at v0.7.3 since the roster is unchanged, but kept for symmetry with the v3→v4 and v4→v5 patterns).
  3. Seeds `regions` from `STARTER_REGIONS`.
  Existing saves pre-dating `description` on `Market` don't gain one through migration; the UI falls back to the live `STARTER_MARKETS` record when rendering. All rival state, ownership, property listings, and `businessIds` are preserved.

### National expansion roadmap — Phase 1 / 2 / 3
The Region model is the axis the map grows along.
- **Phase 1 — Maverick County, NY (v0.7.3, current).** Single playable Region. A fictional county on NYC's outskirts, rich enough to exercise every archetype the game's systems model (urban, suburban, rural, coastal, industrial/port, specialty commercial). The whole v0.8/v0.9 feature set (manager hiring, franchise, cross-market portfolio, 1–2 new business types, rival M&A) lives inside this Region so new systems land before the map expands.
- **Phase 2 — Neighboring regions (mid-roadmap, v0.10–v0.12 band).** Add the real-world regions on Maverick County's border: **NYC boroughs** (Manhattan, Brooklyn, Queens, Bronx, Staten Island), **Long Island** (Nassau, Suffolk), and **New Jersey** (Hudson, Bergen, Essex). Each ships with its own roster (20–40 neighborhoods) and its own macro character (e.g. Manhattan = extreme rent + extreme traffic; Staten Island = suburban density; NJ industrial corridors = port/logistics play). Commuter flows between regions become a modeled thing — a business in Jersey City can draw Manhattan foot traffic at a decay, and rivals can run cross-region portfolios. This is also where the Region state map earns its weight: region-level political events, region-specific macro shocks (transit strike, tri-state bridge closure), region-specific liquor / zoning rules.
- **Phase 3 — National expansion (late-roadmap, v1.0+).** Major US metros unlock as data-only additions: **Los Angeles County (CA)**, **Cook County (IL)**, **Miami-Dade (FL)**, **Harris County (TX)**, **Fulton County (GA)**, and more. Each ships with its own neighborhood roster and metro-specific archetypes that Maverick County can't express (Hollywood studio district, Chicago meat-packing belt, Miami cruise/import belt, Dallas sprawl, Atlanta HBCU corridor, etc.). National scale also unlocks the empire mechanics slotted at v0.9+:
  - **Sports-team ownership** is region-scoped — you buy the team of a Region, not a neighborhood. Home attendance pulls from the Region's whole population × wealth × fandom profile; rival bidders for a franchise skew toward the incumbent owners of that Region. Relocation is a Region-to-Region move with a TV-market math model.
  - **Political office** is Region-scoped at the county / mayor tier and eventually state-scoped (Governor) and national-scoped (Senator, President). A candidacy's name ID, war chest, and coalition all derive from the Regions where the player owns businesses or holds prior office. The `Region.active` flag lets us ship un-playable Regions as scaffolding for these mechanics before their neighborhoods are authored.

### v0.8.0 — Business-type scale ✅
v0.7 made businesses drivable; v0.7.1/.2/.3 expanded the map they live on. v0.8 was the industry scale-up that earlier versions had been deferring. The business roster goes from 4 types to 22, organized into 6 categories, and introduces two shared engines so adding the 23rd type is a config file, not a system.

- **4 → 22 business types** across 6 categories. New types: `food_truck`, `pizza_shop`, `nightclub`, 8 retail subtypes (bookstore, electronics_store, florist, supermarket, jewelry_store, clothing_retail, suit_store, furniture_store), `cinema`, `movie_studio`, `tech_startup`, `gaming_studio`, `construction`, `hospital_clinic`, `real_estate_firm`, `oil_gas`, `military_tech`.
- **Shared engine — `retailBase.ts`.** The 8 retail subtypes are all thin config files (SKU list, elasticity coefficients, restock cadence, staff roster, rent multiplier) plugged into `makeRetailModule(config)`. Lets us add the 9th retail type with a ~40-line file.
- **Shared engine — `projectBase.ts`.** The 4 project-based studios (`construction`, `tech_startup`, `gaming_studio`, `movie_studio`, plus `military_tech`) all drive through `makeProjectModule(config)`. Project pipeline: weekly roll scaled by prestige × marketing; concurrent work caps; hourly burn accrues to `costLedger`; daily completion check pays out (0.7 + quality × 0.5) × budget to `billingLedger` and bumps prestige. Residual tail is config-driven (SaaS 12wk at 1.5%/wk; royalties 52wk at 0.8%/wk; streaming 104wk at 0.4%/wk; construction none).
- **Cinema economics.** Multi-screen (4 screens, 1 premium) with a 28-day film lifetime decay curve (week 1 = 1.0, week 4 ≈ 0.25, 0 after). Weekly auto-rotation picks new films from genre-indexed title pools. Monthly seasonality (summer Jul peak 1.35x, Dec holiday 1.25x) × day-of-week multiplier (Mon 0.65, Sat 1.25) × per-hour attendance curve (peak 19–21). Concessions attach rate 65% at 82% margin booked separately to `concessions` ledger. `streamingPressure` state grows slowly (max 0.6) on daily rolls to bite structural margins over years of in-game time.
- **Hospital clinic.** 24/7 operation with an hour-of-day traffic curve (9–17 = 1.0, 7–21 = 0.65, night = 0.2). Copays are booked immediately as `revenue`; insurance billings accrue to a `pendingInsuranceCents` field and are paid out on the *next* week's tick to the `insurance_billing` ledger (modeling real-world AR lag). `clinicianRatio(state)` throttles hourly throughput. Malpractice: per-visit probability = 0.00008 × (1 − careQuality) × (1 − clinicianSkill); settlement $40K–$160K hits `malpractice_settlement` and cash immediately. $400K startup, unlocks at $320K NW.
- **Real estate firm.** Portfolio of `Property { holdType: "flip"|"manage", purchasePriceCents, renovationCostCents, currentValueCents, monthlyRentCents, occupied, acquiredAtTick, flipTargetWeeks, flipTargetAppreciation }`. Hourly: agent wages 9–18. Daily: value drift (−0.08% .. +0.18%). Weekly: every 4 weeks rolls occupancy (85% stay / 35%+marketing fill), collects 1/4 monthly rent as `rent_income` plus 8% cash-neutral `property_management_fee` for accounting visibility. Flip exits at `flipTargetWeeks` with variance roll and prestige asymmetry (+ on gain, − on loss). Acquisition chance scales with prestige + marketing, capped at 12-property portfolio.
- **Tech startup VC overlay.** `techStartup.ts` wraps `onWeek` with a VC raise overlay: every 12 weeks, probability = 0.12 + prestige × 0.65 of raising $500K–$4M to `vc_proceeds`. Project mechanics otherwise inherit `projectBase` with a 12-week SaaS residual tail at 1.5%/week.
- **Oil & gas.** `Well { id, name, dailyProductionBbl, initialDailyBbl, declinePerWeek, reserveBbl, drilledAtTick, productive }`. Daily tick produces barrels × spot price (`commodity_sale`) minus lifting cost (`cogs`). Weekly: spot-price random walk (−8% to +9%) clamped $45–$110; decline applied per well; 35% chance to drill if under the 6-well cap. Drilling capex $180K–$500K; 68% hit rate. Hit wells generate initial production scaled by capex tier and reserves = initialBbl × 180 × (0.7–1.5). Dry holes lose the full capex. `drilling_capex` ledger lets the finance dashboard separate capital outlay from operating burn.
- **Military tech.** `projectBase` with `gov_contract` billing ledger and `rd_spend` cost ledger. 26–52 week programs, $3M–$28M, 2 concurrent max, no residuals (government checks are one-shot). $500K startup, unlocks at $400K NW — the highest-tier of the project-based ladder. Grand-strategy / tax dashboards can separate private (`project_billing`) vs. public (`gov_contract`) revenue.
- **MarketPage UI — category headers.** Flat 22-button grid would be unscannable. Registry exports `BUSINESS_TYPE_CATEGORIES: Array<{label, types[]}>`; MarketPage renders a small uppercase header per category group above that group's buttons. `defaultNameFor` was rewritten as a full switch covering all 22 types (e.g. food_truck → "Truck", cinema → "Cinema", tech_startup → "Labs", oil_gas → "Petroleum", military_tech → "Defense").
- **15 new ledger categories.** `cover_charge`, `project_billing`, `project_cost`, `vc_proceeds`, `royalties`, `box_office`, `concessions`, `insurance_billing`, `malpractice_settlement`, `property_management_fee`, `flip_gain`, `commodity_sale`, `drilling_capex`, `gov_contract`, `rd_spend`. Every new ledger goes through `pushLedgerEntry` the same as existing ones so the weekly P&L + Finance page absorb them automatically.
- **Engine purity preserved.** Every new module uses the `structuredClone(biz.state)` → mutate clone → repack pattern established in v0.6. `npm run smoke:purchase-tick` still runs 48 ticks against deep-frozen state.
- **Regression canary.** Full smoke suite (`purchase-tick`, `events`, `hospitality`, `cafe`, `real-estate`, `business-loans`) green. `npx tsc --noEmit` clean. `npm run lint` clean (one pre-existing warning in `finance.ts`). `npm run build` 499.66 KB JS / 151.39 KB gz, 439 modules transformed.
- **No save migration needed.** v0.8.0 is purely additive on the business registry side — new types aren't in any existing save, so no save-schema bump. Owning businesses continues to write `Business { type: BusinessTypeId, state: ... }` records through the same `patchBusinessState` path.

### v0.8.1 — Visibility patch ✅
v0.8.0 landed the 22-type roster but players complained they couldn't tell what was happening in their empire: was the store empty because of bad pricing, bad staffing, or just a slow week? v0.8.1 is a diagnostics-only patch that makes every existing lever legible. No new business types; no new simulation mechanics; every change surfaces data the engine was already computing.

- **`selectWealthBreakdown(state)`.** New selector returning `{ personalCash, businessCash, realEstateEquity, mortgageDebt, businessLoanDebt, totalDebt, grossAssets, netWorth }`. `selectNetWorth` now delegates to it for a single source of truth. Dashboard renders a "Where your money is" card with tone-colored asset / debt rows and a hideIfZero flag so early-game players don't see a mortgage row that says $0.
- **Traffic instrumentation on storefront engines.** `BusinessKPIs` gains optional `weeklyVisitors`, `weeklyUnitsSold`, `weeklyConversion` fields. `retailBase.ts` (shared 8-subtype retail engine) and `retail.ts` (`corner_store`) accumulate hourly visitors & units-sold into weekly accumulators, publish them on `onWeek`, then reset. Other storefront engines (cafe, bar, restaurant, nightclub, cinema, food_truck, pizza_shop) stay uninstrumented this patch — they all get re-touched in v0.9 alongside the channelized-marketing rework, so doubling the work now is wasteful. BusinessDetailPage's `TrafficConversionCard` renders the numbers for instrumented types and a "coming in v0.9" placeholder for the rest, so UI never breaks.
- **Staff tab transparency.** The roster Card subtitle now shows `Service ${0..1} → ×${0.6..1.6} conversion` — the exact staffing term the sim applies. Every applicant in the hiring pool shows a marginal-impact line: `Hiring → Service 32% → 41% · (+4.3% conversion)`, driven by `previewServiceAfterHire(current, newAptitude, 72)` (morale 72 matches `buildStaffRecord`).
- **Understaffing warning banner.** `<StaffingWarningBanner biz={biz} />` at the top of the Overview tab. CRIT (loss-colored) when any required roster section is empty — the engines short-circuit to $0 revenue under `staff.length === 0`, which is easy to miss if you walked away from a just-opened store. WARN (amber) when all sections are filled but the weakest section's service is below the 0.5 reference, reporting the gap as a "~X% below potential conversion" estimate. Suppressed under a 10% threshold to avoid noise.
- **Tier explainer text.** Every quality-tier / shelf / menu-program button in `CafeQualityTierCard`, `BarTierCard`, and `RestaurantProgramCard` has a hover tooltip listing exact cost/price/CSAT deltas (e.g. "Premium · +45% price, +35% cost, +25% wages. CSAT caps at 95"). An in-card prose line under the active tier gives the same info always-visible for touch devices. Happy Hour / ID Checks / Reservations / Menu Refresh buttons gain tooltips documenting the trade-off they make.
- **Shipped changes, no sim impact.** `tsc --noEmit` clean. Existing saves load unchanged — the new KPI fields are optional, and the storage-key bump on the tutorial (`ma:tutorial:v0.8.0` → `v0.8.1`) is solo-player-safe (this is a single-player hobby build). No schema migration needed.

### v0.9 — Failure & Flow ✅
v0.8 made the world big; v0.8.1 made it legible. But the sim still has two structural gaps that a real tycoon game can't live without: **you can't actually lose** (negative cash just accumulates forever, loans never collapse to personal), and **you can't skip the boring parts** (auto-tick is the only time model, so late-empire play becomes a chore). v0.9 closes both, then pairs them with two quality-of-life wins that ride the same plumbing — market-aware recommendations and buy-vs-lease on commercial property.

**1. Bankruptcy cascade.** A realistic failure path at the business and personal level.
- `BusinessStatus = "operating" | "distressed" | "insolvent" | "liquidated"` on every business.
- **Distressed** fires the moment biz `cash < -$5,000` for a single week; warning banner on BusinessDetailPage + dashboard, no mechanical effect yet.
- **Insolvent** fires after **4 consecutive weeks** underwater. Engine triggers liquidation: business assets (inventory + fixtures book value) sold at **40% of book** to `liquidation_proceeds`; the spread goes to `liquidation_writeoff`. Any outstanding `BusinessLoan` balance left after the cash sweep collapses onto the player as `personalUnsecuredDebtCents` — the personal guarantee clause on SBA loans becoming real.
- **Voluntary close** action on distressed biz: sells at **60% of book** (better than forced 40%), debt still collapses, but credit hit is −40 instead of −80. Creates a meaningful "eject early" decision.
- **Personal bankruptcy** fires when `cash + liquidAssets + 0.5 × realEstateEquity < personalUnsecuredDebt × 0.25`. Effects: all real estate foreclosed at 90% of market value (mortgages paid off first), remaining unsecured debt discharged, credit → 300, `bankruptcyFlag` set with **7-year lockout** on new business loans + doubled down-payment requirements.
- **Heir fallback.** If `player.children` has an eligible heir (age ≥ 18), the run continues as that heir with a clean balance sheet and a −20 `familyReputation` hit. If no eligible heir, game-over modal with a "Replay as new founder" button.
- Closed-business graveyard view on `/business` with postmortem data (weeks alive, peak revenue, final cash).

**2. Advance Day / Week / Event buttons.** Hybrid time model: auto-tick keeps running, fast-forward is opt-in.
- Three buttons in the top bar: `Day ▸` / `Week ▸` / `Event ▸`.
- `advanceUntil(predicate, maxTicks=336)` store action runs `tick()` synchronously until the predicate hits, a blocking event fires, or a 2-week safety cap is reached. Autosave fires once at burst end, not per-tick.
- `event.blocking: boolean` flag on the `Event` type marks the categories that interrupt fast-forwards: distress warnings, macro-shock activation/expiry, rival territorial moves, personal lifecycle, major milestones.
- `settings.pauseOnEvent: "all" | "blocking" | "never"` — default `"blocking"`. Late-empire players can flip to `"never"` when event spam stalls fast-forwards.

**3. Market-aware recommendations.** Scoring function + MarketPage reorganization so the 22-type grid stops being a wall of buttons.
- `scoreBizTypeForMarket(type, market, player) → { score: 0..1, reasons: string[], viable: boolean }` lives in `src/engine/market/recommendations.ts`.
- Factors: demographic fit (population × income curve per type), competition (diminishing returns past 2 existing), archetype match (Coastal → restaurants + florists; Industrial → oil_gas + construction; Specialty Medical → hospital_clinic), halo benefits (own a café here → bar scores up), macro fit (pulses shift scores).
- MarketPage reorganizes each market card into three stacks: **Good fits here** (top 5 scored), **Already in this market** (occupied slots), and **All types** (the current full grid, collapsed by default).
- Tutorial cold-open uses the same scoring to pre-select the strongest corner_store / cafe pair under $35K.

**4. Buy-vs-lease commercial space.** Wire the existing `buyProperty` + `Property.hostedBusinessId` plumbing into the new-business UI and the detail page — it's all sitting there, unused.
- BuyBusinessDialog gets a **Lease (default) / Buy property** radio. Buy reveals available commercial properties in that market; startup cost = property price + fixtures; finance option reuses existing mortgage + business-loan infrastructure.
- Lease-then-buy action on the Finance tab of an already-leased business when a commercial property of the right fit is listed in its market.
- BusinessDetailPage Overview header gains a hosted-state indicator: **🏠 Owned space** or **📝 Leasing — $X/mo**. Hosted businesses show $0 rent on the weekly P&L with a tooltip explaining property taxes + maintenance still apply.
- Selling a hosted property now fires a confirm dialog: "This property hosts [Biz Name]. Selling forces relocation (2-month lease deposit in this market) or closure." Auto-voluntary-close at 60% book if relocation funds insufficient.

**Out of scope for v0.9 (moved):** channelized marketing, promotions, signage, loyalty, hours of operation → v0.10. Player skill wiring, SKU curation, supplier deals → v0.11. Managers / franchise / portfolio → v1.0.

**Save compat.** Schema bump v6 → v7, additive migration: every `Business` gains `status: "operating"` + `insolvencyWeeks: 0`; every `PlayerCharacter` gains `personalUnsecuredDebtCents: 0`, `bankruptcyHistory: []`, `closedBusinessIds: []`, and an optional `bankruptcyFlag`; `GameState` gains `settings.pauseOnEvent: "blocking"` as default. No data loss.

**Shipped implementation notes.**
- Insolvency state machine lives in `src/engine/business/insolvency.ts`; the 4-week clock is driven by weekly roll-ups inside `stepTick` and deliberately ignores rival-owned businesses.
- Liquidation proceeds and credit impact are centralised in `src/engine/business/liquidation.ts` (`RECOVERY_RATE` / `CREDIT_IMPACT`). `closeBusinessVoluntarily` reuses the same cleanup so the eject-early path shares one implementation.
- Personal bankruptcy filing (`src/engine/player/bankruptcy.ts`) runs immediately after the liquidation cascade inside the same tick — this is what the `smoke:bankruptcy` regression proves end-to-end (distressed → insolvent → loan collapse → Chapter 7 → succession).
- Advance controls wrap a single store action, `advanceUntil(predicate, maxTicks = 336)`; it short-circuits on blocking events and autosaves exactly once at burst end.
- Recommendation scoring (`src/engine/market/recommendations.ts`) feeds three MarketPage stacks — *Good fits*, *Already in this market*, *All types* — all rendered from the same per-market card so the 22-type grid no longer walls off new players.
- Buy-vs-lease is handled by `convertBusinessToOwned` / `convertBusinessToLease` / `sellHostedProperty` store actions plus the `ConvertToOwnedCard` + `SellHostedConfirmDialog` UI. Selling a hosted property always tries relocation first, falling back to voluntary close only when the 2-month lease deposit can't be funded from business + personal cash.

### v0.10 — Marketing & Levers (next)
v0.9 closed the failure and flow gaps — now players can actually lose, can skip the boring parts, and can reason about which market fits which business. v0.10 returns to the lever surface: the existing `marketingWeekly` slider is still a black-box single knob, and every sales lever below it is still missing. v0.10 builds the full marketing/lever surface that lets players tell a story with their business.

**Channelized marketing** replacing the single slider:
- Six channels — radio, social media, TV, magazines, out-of-home (billboards / transit), email / owned — each with its own `$/wk` input, demographic reach curve (age × income), saturation cap, and decay rate.
- Market demographics extended: each `Market` gets `demographics: { medianAge, medianIncome, ageSkew, incomeSkew }`. Per-channel effectiveness = `dot(channelReach, marketDemographics)`, so TV is cheap reach for older / higher-income suburban markets, social is cheap reach for young urban markets, etc.
- Per-business `marketingScoreByChannel: Record<Channel, number>` replaces the scalar `marketingScore`; decay is per-channel so a one-off radio burst doesn't compete with a sustained social program.

**Sales levers** on every storefront/hospitality biz:
- **Promotions / store-wide sales.** Percent-off knob (0–50%) with scheduled start/end weeks. Boosts conversion and weekly traffic at the cost of margin; CSAT nudge downward during the sale, upward for a few weeks after ("deal memory").
- **Signage upgrade tiers.** One-time capex purchases (Banner → Lit Sign → Digital Marquee) that raise the base traffic capture rate for the biz's location. Tiered cost curve; decays very slowly.
- **Loyalty programs.** Per-biz toggle + tier. Trades a small per-transaction discount for repeat-visit frequency lift, modeled as a `repeatCustomerShare` term that reduces the churn component of weekly traffic.
- **Hours of Operation.** Per-biz schedule (open/close per day-of-week). Shorter hours save labor but cap peak-window revenue; 24/7 adds a graveyard labor premium and a small CSAT bump for convenience.

### v0.11 — Progression (deferred from v0.9)
The `PlayerCharacter.skills` map has lived in types since v0.1 and `addSkillXp` has lived in `src/engine/player/skills.ts` since v0.1 — but neither is wired to gameplay. v0.11 makes the player's six skills actually matter, and adds the inventory levers players expect from a sim of this shape.

**Skill system wire-in.**
- Six skills (`management, negotiation, finance, charisma, tech, operations`) gain per-skill XP accrual on relevant activity:
  - `management` → per active week running ≥ 1 biz with staff
  - `negotiation` → per lease signed, property purchase, rival M&A deal
  - `finance` → per loan taken, per in-game year survived
  - `charisma` → per marketing-active week, per CSAT above 80
  - `tech` → per week running tech_startup / gaming_studio / military_tech
  - `operations` → per week running a manufacturing / heavy-industry biz
- Skills feed back through `skillEffectiveness(value) → 0..1` S-curve multipliers at existing sim chokepoints: staffing morale decay, marketing effectiveness, negotiated prices on property listings, tick-level CSAT ceiling, loan rate spreads.

**SKU curation.** Players can add/drop SKUs from a biz's catalog (currently fixed per subtype). Each SKU has a `demographicFit: { ageSkew, incomeSkew }` curve. Dropping a bad-fit SKU can lift margin; adding a right-fit SKU can lift traffic. Per-subtype "SKU pool" defines what's available.

**Supplier deals.** Per biz-type, 2–4 suppliers with `{ minMonthlySpendCents, costMultiplier }` trade-offs. Exclusive deal: 1 supplier at a time per biz. Meet the minimum monthly → per-SKU cost drops 4–12%. Miss the minimum → pay the penalty month. `negotiation` skill lowers the minimum threshold.

### v1.0 — Portfolio owner (deferred from v0.9)
With 22 types available and marketing levers in place, the bottleneck becomes attention: a player can't actively run 22 businesses. v1.0 is about crossing the threshold from *operator* to *portfolio owner*.
- **Manager / GM hiring.** Assign a manager to a business; tick runs at ~85% of hands-on efficiency but needs no active attention. Fee = `salary + bonus on quarterly profit`.
- **Clone / franchise flow.** Open a 2nd location of an existing business type at a reduced startup cost (shared brand, negotiated supplier contracts). A property-hosted store carries quality benefits to its clone.
- **Cross-market portfolio view.** A dashboard that rolls up every business the player owns with a heatmap by market and a stacked P&L.
- **Rival M&A.** Rivals can offer to buy your struggling businesses; you can make offers on theirs. Triggers a negotiation dialog gated on credit, cash, and strategic fit.
- **Multiple save slots.** Named slots (`"clean-run"`, `"hardcore-2026"`), slot picker on home screen, slot export for sharing.

### v1.0+ — Empire (deferred)
Previously slotted for v0.9, but the team judged that without multi-region play, these mechanics don't have enough surface area. Moved out to post-national-expansion.
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
