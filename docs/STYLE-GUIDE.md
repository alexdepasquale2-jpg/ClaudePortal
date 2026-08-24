# Style Guide

Formatting is Prettier's problem (`npm run format`). This document covers the things a formatter
cannot decide.

## Naming

- Files are named after the single thing they export: `OwnershipFlip.ts` exports `OwnershipFlip`.
- Types and classes `PascalCase`, values and functions `camelCase`, data files `kebab-case.json`.
- Keep the design's vocabulary exactly: NNN, Goliath, Sancient, Nobot, Neetmon, Pyron Chrome,
  solidify, jack, flip, lit. Do not translate them into generic engineering words. A reader moving
  between `DESIGN.md` and the code should never have to guess at a synonym.
- British spelling in design vocabulary where the design uses it (`radicalisation`), because matching
  the design doc matters more than internal consistency with `initialize`.

## Imports

- Cross-layer imports use path aliases (`@core/...`), never relative paths. Within a layer, relative.
- `import type` for types — `verbatimModuleSyntax` is on and will tell you.
- Never import `gameplay` from `ui`. Lint will stop you; know why before you try to work around it.

## Comments

Every module opens with a TSDoc block that restates **the specific design rule it enforces**, in the
design's own words where possible. Not "handles ownership" — rather "when a run resolves, ownership
of the site can flip to whoever contested it; the fort does not survive, the flip does."

Inline comments explain _why_, never _what_. If the what is unclear, the code is wrong.

`// TODO: implement per DESIGN.md` is the marker for scaffolded surface. It means: signature is
intentional, behaviour is not written yet. Do not remove one without implementing it.

## Types

- `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Do not weaken tsconfig.
- No `any`. `unknown` plus a narrow is fine.
- Prefer closed unions over enums for design vocabulary — they are exhaustively checkable and they
  serialise as themselves.
- Make illegal states unrepresentable where a design rule depends on it. `CampaignSave` having no
  field for fort geometry is a load-bearing absence.

## Runtime discipline

- No `Math.random()` in `gameplay` or `campaign`. Take a `SeededRandom`.
- No allocation in per-frame hot paths. Use `ObjectPool`; reuse vectors.
- Systems take `dt` and are registered explicitly. No hidden lifecycle, no module-level side effects.
- Mobile is a target, not a downgrade: assume a mid-range phone and a 60Hz budget.

## Tests

- A test name states the invariant, not the method: `death at a lit site flips ownership`.
- `it.todo()` for contracts that exist but are not implemented — it keeps the suite honest and green.
- If a test is hard to write because the seam is wrong, fix the seam.
