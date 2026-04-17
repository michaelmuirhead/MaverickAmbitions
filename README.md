# Maverick Ambitions

A generational business simulation game set in **Maverick County, NY** — a fictional booming county on the outskirts of New York City. Start with a single corner store. Build an empire. Pass it to your heirs.

Inspired by Big Ambitions. iPhone-first, with real iPad and Desktop layouts.

---

## Status

**v0.8.0 — Business-type scale update.** The core loop is playable end-to-end: start at 24 with $15K, run a corner store / café / bar / restaurant, buy real estate, marry, have kids, pass the empire to an heir. Rivals play the same game you do and will take your territory. The global economy shocks you with commodity shortages, interest-rate spikes, liquor tax hikes, viral food trends, and more — rivals adapt too.

v0.8.0 is the scale update for industries. The business roster goes from 4 types (corner store, café, bar, restaurant) to **22 types** across six categories:

- **Food & Hospitality** — corner_store, cafe, bar, restaurant, pizza_shop, food_truck, nightclub
- **Retail** — bookstore, electronics_store, florist, supermarket, jewelry_store, clothing_retail, suit_store, furniture_store (all 8 built on a shared retail engine with per-SKU elasticity and inventory)
- **Entertainment** — cinema (multi-screen programming with 28-day film lifetime + concessions), movie_studio (long-cycle productions with 104-week streaming tail)
- **Services** — hospital_clinic (24/7, copay + delayed insurance billing, clinician-ratio throttling, malpractice risk), real_estate_firm (flip + manage portfolio, monthly rent collection, appreciation drift)
- **Project-based / knowledge work** — tech_startup (R&D burn + SaaS residuals + VC raise overlay), gaming_studio (52-week royalty tail), construction (no residuals, large crew)
- **Heavy Industry** — oil_gas (per-well production + decline + weekly spot-price random walk + drilling capex), military_tech (slow-moving gov_contract ledger + rd_spend)

Two shared engines live under `engine/business/` — `retailBase` (8 retail subtypes) and `projectBase` (4 project-based studios). New ledger categories were added for v0.8: `cover_charge`, `project_billing`, `project_cost`, `vc_proceeds`, `royalties`, `box_office`, `concessions`, `insurance_billing`, `malpractice_settlement`, `property_management_fee`, `flip_gain`, `commodity_sale`, `drilling_capex`, `gov_contract`, `rd_spend`. Grand-strategy dashboards can now separate private vs. public revenue, and recurring vs. one-shot income.

The MarketPage button grid was reorganized from a flat list to category headers so the UI remains scannable at 22 types.

Prior milestones:

- **v0.1** — Architectural scaffold, corner store MVP, one rival
- **v0.2** — Family & dynasty (marriage, children, inheritance)
- **v0.3** — Real estate (buy / sell / rent / commercial leases)
- **v0.4** — Hospitality triad (café, bar, restaurant)
- **v0.5** — Macro shocks (additive rates, multiplicative wallet/RE/labor, rival reaction matrix)
- **v0.5.1** — SBA-style business loans (credit-banded LTC, 60mo amortization, personal guarantee)
- **v0.6** — Vite + React Router + engine-purity hardening (no more frozen-mutation clock freezes)
- **v0.7** — Player agency: per-business detail pages, per-SKU pricing sliders, hire/fire/wage controls, marketing budget UI, first-time tutorial, events feed upgrade
- **v0.7.1** — Expanded market roster: 4 → 22 neighborhoods across urban, suburban, rural, and specialty commercial archetypes
- **v0.7.2** — Region-scale roster: 22 → 46 neighborhoods; added Coastal/Resort and Industrial/Port tiers; save-compat v4 → v5 migration
- **v0.7.3** — Maverick County, NY setting + Region data model; NY-flavored neighborhood descriptions; Phase 1/2/3 national expansion roadmap; save-compat v5 → v6 migration
- **v0.8.0** — Business-type scale: 4 → 22 types across 6 categories; shared `retailBase` and `projectBase` engines; cinema film-lifetime economics; hospital insurance lag + malpractice risk; real-estate flip/manage portfolio; tech-startup VC overlay; oil & gas well depletion; military-tech gov contracts

Next up: see [`DESIGN.md`](./DESIGN.md) §13 for the v0.9+ roadmap.

---

## Getting started

Requires Node 18.17+.

```bash
npm install
npm run dev
```

Open <http://localhost:5173>.

### Scripts

- `npm run dev` — Vite dev server (HMR, port 5173)
- `npm run build` — Production build (outputs to `dist/`)
- `npm run preview` — Serve the built `dist/` locally
- `npm run typecheck` — TypeScript check without emit
- `npm run lint` — ESLint
- `npm run smoke` — Run all engine smoke tests (purchase-tick, events, hospitality, café, real estate, business loans)
- `npm run smoke:purchase-tick` / `smoke:events` / `smoke:hospitality` / `smoke:cafe` / `smoke:real-estate` / `smoke:business-loans` — Individual suites

---

## Deploying

The app is a pure static bundle — `dist/` after `npm run build`. It uses a **hash router** (`#/dashboard`), so any static host works with no URL-rewrite rules:

- **GitHub Pages** — push `dist/` to `gh-pages`.
- **Cloudflare Pages / Netlify / Vercel static** — point the build at `npm run build`, output `dist/`.
- **S3 + CloudFront** — upload `dist/`, set `index.html` as both index and error document.
- **nginx / Apache** — serve `dist/`; no rewrite config needed.

---

## Project layout

```
src/
├── App.tsx           React Router route table (HashRouter)
├── main.tsx          Vite entry — mounts <App /> into #root
├── routes/           Page components (one file per route)
├── components/       UI (layout, primitives, game widgets)
├── engine/           Pure game logic — no React imports
├── state/            Zustand store + slices
├── data/             Static data (SKUs, names, tax brackets)
├── hooks/            React ↔ engine bridge
├── lib/              Utilities (RNG, money, date)
├── types/            Shared TypeScript types
└── styles.css        Global CSS (Tailwind directives + iOS safe-area)
```

The golden rule: `engine/` never imports from `components/` or `routes/`. That keeps the simulation testable and lets us later run rival AI server-side or in a web worker.

---

## Design pillars (short version)

1. Depth without grind.
2. Generational stakes — you're a lineage, not a character.
3. Rivals that play the same game you do, and will take your territory.
4. Systems scale from a corner store to a nation.
5. iPhone-first, but iPad and Desktop get real layouts — not a stretched phone.

---

## License

MIT — see [`LICENSE`](./LICENSE).
