# Maverick Ambitions

A generational business simulation game. Start with a single corner store. Build an empire. Pass it to your heirs.

Inspired by Big Ambitions. iPhone-first, with real iPad and Desktop layouts.

---

## Status

**v0.6 — Vite + SBA loans.** The core loop is playable end-to-end: start at 24 with $15K, run a corner store / café / bar / restaurant, buy real estate, marry, have kids, pass the empire to an heir. Rivals play the same game you do and will take your territory. The global economy shocks you with commodity shortages, interest-rate spikes, liquor tax hikes, viral food trends, and more — rivals adapt too. SBA-style business loans close the starter soft-lock: $15K cash + good credit now opens a corner store on day one.

Shipped milestones:

- **v0.1** — Architectural scaffold, corner store MVP, one rival
- **v0.2** — Family & dynasty (marriage, children, inheritance)
- **v0.3** — Real estate (buy / sell / rent / commercial leases)
- **v0.4** — Hospitality triad (café, bar, restaurant)
- **v0.5** — Macro shocks (additive rates, multiplicative wallet/RE/labor, rival reaction matrix)
- **v0.5.1** — SBA-style business loans (credit-banded LTC, 60mo amortization, personal guarantee)
- **v0.6** — Vite + React Router (HashRouter) — dropped Next for deploy simplicity

Next up: **v0.7 Industries** (tech-startup module). See [`DESIGN.md`](./DESIGN.md) §13 for the full roadmap.

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
- `npm run smoke` — Run all engine smoke tests (events, hospitality, café, real estate, business loans)
- `npm run smoke:events` / `smoke:hospitality` / `smoke:cafe` / `smoke:real-estate` / `smoke:business-loans` — Individual suites

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
