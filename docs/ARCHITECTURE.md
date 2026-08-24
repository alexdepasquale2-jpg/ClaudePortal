# Architecture

SkyNeet Survivors is a browser game: TypeScript, Vite, Three.js/WebGL, no server. It runs on desktop
and mobile from the same bundle. See ADR-0005 for why the platform is the web rather than Unity.

## The layer graph

Five layers, imports strictly one-directional:

| Layer      | Path            | May import             |
| ---------- | --------------- | ---------------------- |
| `core`     | `src/core/`     | _(nothing)_            |
| `render`   | `src/render/`   | core                   |
| `campaign` | `src/campaign/` | core                   |
| `gameplay` | `src/gameplay/` | core, campaign, render |
| `ui`       | `src/ui/`       | core, campaign, render |
| `scenes`   | `src/scenes/`   | all of the above       |
| `app`      | `src/main.ts`   | core, scenes           |

`scenes` is the composition root — the only place where a live run and the campaign menus are
allowed to meet, and only by handing a `RunResult` from one to the other.

### The rule that matters

**`ui` may not import `gameplay`.** This is the mechanical enforcement of ADR-0002 (session-only
forts): `FortsMenuController` cannot reach `FortRuntime`, because the module graph forbids it. The
Forts Menu can only read persisted campaign history and load blueprints — exactly what the design
says it does.

This is not documentation-by-hope. `eslint-plugin-boundaries` fails `npm run lint` on any violation,
and CI runs lint on every push. The rule has been verified by deliberately breaking it and confirming
the failure.

The layer of every import is visible at the call site because everything crosses layers through path
aliases: `@core/*`, `@campaign/*`, `@gameplay/*`, `@ui/*`, `@scenes/*`, `@render/*`.

## Mapping from the original Unity spec

The design was first written as a Unity project. The translation is mechanical:

| Unity concept               | Web equivalent                                                |
| --------------------------- | ------------------------------------------------------------- |
| `.asmdef` assemblies        | layers + `eslint-plugin-boundaries` rules                     |
| `MonoBehaviour`             | plain classes with explicit `update(dt)` driven by `RunClock` |
| `ScriptableObject` `.asset` | typed JSON in `src/core/data/**` + a zod schema               |
| `.unity` scenes             | `Scene` modules under `src/scenes/`, swapped by `SceneRouter` |
| `.prefab`                   | factory functions building Three.js object graphs             |
| `.inputactions`             | `InputSource` adapters (`KeyboardMouseInput`, `TouchInput`)   |
| EditMode tests              | `tests/unit/**` (vitest)                                      |
| PlayMode tests              | `tests/e2e/**` (Playwright, real browser)                     |

## Scenes, and the rule about the archipelago

`SceneRouter` holds exactly one active scene. The design is explicit: **never load the entire
archipelago as one physics scene. One operation = one scene.** `WorldScene` and `RegionScene` are
menu layers over campaign data — they render a map, not a simulated world. Only `OperationScene`
instantiates a live site, and only one at a time.

This is why `campaign` cannot import `gameplay`: campaign data must be renderable without any run
machinery existing.

## Two deliberate placements

1. **Live in-session UI lives in `gameplay`, not `ui`.** `TowerDefenseOverlay` and `BlueprintGhostUI`
   sit in `src/gameplay/presentation/` because they read live fort state. Putting them in `ui` would
   have forced `ui → gameplay` and destroyed the rule above. They reach the DOM through
   `LiveBuildingPresenter`.

2. **`meta` and `data` live under `core`.** Feats, the tech tree, unlocks, and every data definition
   are consumed by both `campaign` and `gameplay`. Anywhere else they would create a cycle.

## Determinism

`SeededRandom` (`src/core/utilities/`) is a real implementation, not a stub — mulberry32, explicit
state, serialisable. Site generation, card draws, and Sancient scheduling all take a seed. A run must
be reproducible from `(campaignSeed, siteId, runIndex)` or `SeededGeneration` is meaningless and no
leaderboard claim can ever be checked.

Never call `Math.random()` in `gameplay`. Take a `SeededRandom`.

## Update model

There is one loop, in `core/time/RunClock`, with a fixed simulation step and a variable render step.
Systems implement `update(dt: number): void` and are registered explicitly — no hidden discovery, no
per-frame allocation in the hot path. `ObjectPool` exists because a Survivors-spine game spawns
projectiles and Goliaths by the hundred and mobile GC pauses are visible.

## Networking

Single-player local today, but the host-authority boundary from the design is already a real
interface: place / solidify / scrap go through `BuildAuthority`. See `NETWORKING.md`.
