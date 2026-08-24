# ADR-0005: The game is a browser application, not a Unity project

- **Status:** Accepted
- **Date:** 2026-08-24
- **Supersedes:** the Unity-oriented scaffolding in the original design brief

## Context

The design brief specified a Unity project: assembly definitions, ScriptableObjects, prefabs, scenes,
per-OS build workflows. The requirement that overrode it is simpler: **it has to be runnable from the
web or a phone.**

Unity does target WebGL, but the cost is real — a heavyweight bundle, a slow load, an editor-bound
authoring loop, and a build pipeline that cannot run in a plain CI container without licences. None
of that is worth paying when nothing in the design needs Unity specifically.

What the design _does_ need is a real 3D scene, because "one pawn, three live-switchable views" with
a genuine first-person camera cannot be faked in 2D.

## Decision

TypeScript, Vite, Three.js/WebGL. No server, no accounts. Campaign state in IndexedDB with JSON
export/import. Desktop and mobile from one bundle; touch is a first-class input adapter, not a
fallback.

The architecture is preserved, not abandoned. The mapping is in `ARCHITECTURE.md`; every `.cs` file in
the brief has a `.ts` counterpart at the equivalent path. Assembly separation becomes
`eslint-plugin-boundaries` rules that fail CI — the same graph, enforced by something that actually
runs.

## Consequences

**Good**

- Playable by opening a URL. On a phone, installable to the home screen.
- The whole pipeline runs in a plain container: typecheck, lint, unit tests, real-browser E2E tests,
  production build. No licences, no editor.
- Assembly isolation is now CI-verified rather than editor-configured, and was proven by deliberately
  breaking it.
- Fast iteration: hot reload, and every system testable headlessly because none of it is bound to an
  engine lifecycle.

**Costs**

- Everything Unity provides free is now ours to write: the update loop, pooling, scene management,
  the input abstraction, an asset pipeline. `core/` is larger than it would have been.
- No editor tooling. The five `tools/` CLIs replace the Editor windows from the brief, and inspecting
  game state means writing a tool rather than clicking an object.
- Mobile WebGL is a real performance ceiling. `QualityTier` treats mobile as a distinct budget rather
  than a downscale, and hot-path allocation discipline is mandatory rather than advisory.
- Physics is not provided. Whatever the fort and projectiles need must be chosen deliberately — and
  has not been chosen yet.
