# SkyNeet Survivors

**Every run changes the battlefield for the next run.**

You are Neetmon Gould — one body, on foot, underground. The machines that inherited the surface still
carry full Goliath catalogs but have forgotten how to use them. Underground, machine signal is dead
until you plant a NeetNetNode. Lighting one is always a deliberate, dangerous decision. Building is
loud. Loudness brings the Sancients. Sancients temporarily restore full competence to nearby
Goliaths. When you die or extract, ownership of the site and its production can flip.

There is no win state. The game simply progresses.

> **Status: scaffolding.** Module contracts, documentation and the full architecture are in place;
> gameplay logic is not implemented. See [`docs/SCOPE-LEDGER.md`](docs/SCOPE-LEDGER.md) for exactly
> what exists and what the next vertical slice is.

## Run it

```bash
npm install
npm run dev        # --host is already set: open the printed LAN URL on your phone
```

It is a browser game — desktop and mobile from the same bundle, no server, no account. Campaign state
lives in your browser's IndexedDB and can be exported to a JSON file.

```bash
npm run typecheck  # strict TypeScript
npm run lint       # includes the layer-boundary rules
npm run test       # unit tests (vitest)
npm run test:e2e   # real-browser tests, desktop and mobile viewports (Playwright)
npm run build      # production bundle into dist/
```

## The session / campaign boundary

This is the single most important thing to understand before changing anything.

**A session is one operation.** One site, one scene, one run. Inside it you walk, fight, scavenge,
plant nodes, and build a fort that becomes ridiculous. All of it is temporary. **The fort you build
this run dies with the run** — geometry, modules, walls, all of it. That is deliberate
([ADR-0002](docs/adr/0002-session-only-forts.md)): the escalation is a spike, not a plateau, and
losing a site should cost you a position rather than hours of construction.

**The campaign is the archipelago graph.** Sites, edges, ownership, stockpiles, pipelines, faction
attitudes, Nobot radicalisation, feats, and the history of every resolved run. It persists. It is the
only thing that does. **The graph is the keep**
([ADR-0001](docs/adr/0001-persistent-campaign-graph.md)).

A run touches the campaign exactly once, at the end, through a `RunResult`. Ownership flips.
Production is inherited. The next run walks into the battlefield this one left behind.

The boundary is enforced by the module graph, not by discipline: `ui` cannot import `gameplay`, so the
Forts Menu physically cannot reach a live fort. `npm run lint` fails if you try.

## The five pillars

Every feature must serve at least one. A feature that serves none is out of scope.

| Pillar          | The line                                            | What it protects                                                  |
| --------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| **Greed**       | "There's more scrap over there."                    | The pull outward. Distance from extraction is a bet.              |
| **Dread**       | "Should we turn on NNN?"                            | The deliberate, dangerous decision. Never incidental, never free. |
| **Power**       | "This fort is becoming ridiculous."                 | The escalation spike inside one run — and its impermanence.       |
| **Panic**       | "The Sancient made them competent."                 | The reversal: the clown turns, acquires, waits, and fires.        |
| **Consequence** | "We lost this site, and now somebody else owns it." | Every run writing itself into the graph.                          |

When two pillars conflict, **Consequence wins.** A run that does not change the battlefield is a run
the game did not happen in. Full detail in [`docs/PILLARS.md`](docs/PILLARS.md).

## Layout

```
src/core/       foundation: events, clock, noise, seeded RNG, data schemas, meta progression
src/render/     Three.js scene plumbing and the three camera rigs
src/campaign/   the persistent graph: sites, ownership, influence, pipelines, save
src/gameplay/   one live run: player, building, nodes, enemies, factions, extraction
src/ui/         campaign menus and HUD  (cannot import gameplay — that is the point)
src/scenes/     Boot / MainMenu / World / Region / Operation / BlueprintSandbox / Settings
tools/          five CLIs: blueprint validation, graph visualisation, noise heatmaps, balance, i18n
tests/          unit (vitest) and real-browser e2e (Playwright)
```

One operation = one scene. The archipelago is never loaded as a live scene.

## Documentation

| Document                                      | What it covers                                           |
| --------------------------------------------- | -------------------------------------------------------- |
| [`DESIGN.md`](docs/DESIGN.md)                 | The locked concept. Single source of truth.              |
| [`PILLARS.md`](docs/PILLARS.md)               | The five pillars and the tie-break rule.                 |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md)     | Layer graph, enforcement, Unity→web mapping.             |
| [`DATA-CONTRACTS.md`](docs/DATA-CONTRACTS.md) | Every data file and the schema validating it.            |
| [`SAVE-FORMAT.md`](docs/SAVE-FORMAT.md)       | What persists, what never does, and migrations.          |
| [`NETWORKING.md`](docs/NETWORKING.md)         | Host authority over place/solidify/scrap.                |
| [`STYLE-GUIDE.md`](docs/STYLE-GUIDE.md)       | Conventions a formatter cannot decide.                   |
| [`SCOPE-LEDGER.md`](docs/SCOPE-LEDGER.md)     | Status, deliberate omissions, next vertical slice.       |
| [`GAPS.md`](docs/GAPS.md)                     | Questions this scaffolding deliberately does not answer. |
| [`adr/`](docs/adr/)                           | Locked decisions, with their costs stated.               |

## Licence

MIT. See [`LICENSE`](LICENSE).
