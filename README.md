# Maverick Ambitions

A generational business simulation game. Start with a single corner store. Build an empire. Pass it to your heirs.

Inspired by Big Ambitions. iPhone-first, with real iPad and Desktop layouts.

---

## Status

**v0.5 — Macro shocks are live.** The core loop is playable end-to-end: start at 24 with $15K, run a corner store / café / bar / restaurant, buy real estate, marry, have kids, pass the empire to an heir. Rivals play the same game you do and will take your territory. The global economy now shocks you with commodity shortages, interest-rate spikes, liquor tax hikes, viral food trends, and more — rivals adapt too.

Shipped milestones:

- **v0.1** — Architectural scaffold, corner store MVP, one rival
- **v0.2** — Family & dynasty (marriage, children, inheritance)
- **v0.3** — Real estate (buy / sell / rent / commercial leases)
- **v0.4** — Hospitality triad (café, bar, restaurant)
- **v0.5** — Macro shocks (additive rates, multiplicative wallet/RE/labor, rival reaction matrix)

Next up: **v0.6 Industries** (tech-startup module). See [`DESIGN.md`](./DESIGN.md) §13 for the full roadmap.

---

## Getting started

Requires Node 18.17+.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

### Scripts

- `npm run dev` — Next.js dev server
- `npm run build` — Production build
- `npm run start` — Start production server
- `npm run typecheck` — TypeScript check without emit
- `npm run lint` — ESLint
- `npm run format` — Prettier
- `npm run smoke` — Run all engine smoke tests (events, hospitality, café, real estate)
- `npm run smoke:events` / `smoke:hospitality` / `smoke:cafe` / `smoke:real-estate` — Individual suites

---

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it into Vercel — it auto-detects Next.js and needs no configuration.
3. Ship.

---

## Project layout

```
src/
├── app/              Next.js routes (iPhone-first, responsive)
├── components/       UI (layout, primitives, game widgets)
├── engine/           Pure game logic — no React imports
├── state/            Zustand store + slices
├── data/             Static data (SKUs, names, tax brackets)
├── hooks/            React ↔ engine bridge
├── lib/              Utilities (RNG, money, date)
└── types/            Shared TypeScript types
```

The golden rule: `engine/` never imports from `components/` or `app/`. That keeps the simulation testable and lets us later run rival AI server-side or in a web worker.

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
