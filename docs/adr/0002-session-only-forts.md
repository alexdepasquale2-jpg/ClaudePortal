# ADR-0002: Forts exist only inside play sessions

- **Status:** Accepted
- **Date:** 2026-08-24

## Context

The Power pillar is "this fort is becoming ridiculous." That escalation is the best feeling in a run.
The instinct is to let the player keep it — return next run and find their walls standing.

That instinct is wrong, and the design locks against it: _the fort you built this run dies with the
run; the campaign graph remembers._

Persistent forts would:

- flatten the Power curve into a plateau — you no longer build a ridiculous fort, you visit one
- make every run start from a saved-game state rather than a decision
- turn losing a site into losing an asset you had invested hours in, which makes players stop taking
  risks, which kills Greed and Dread together
- require persisting geometry, damage, partial construction, and resource debt, forever, per site

## Decision

Forts are **session-only**. Pieces, modules, transforms, and health exist only while the run is live.
When the run resolves — extract, death, or abandon — the fort ceases to exist.

What survives is only the fort's consequences: ownership defended or lost, materials consumed,
production enabled, noise made. Those are graph mutations, and they persist.

Blueprints are the deliberate exception: they are _plans_, authored between runs, loaded as ghosts,
and paid for in full every time. A blueprint carries no state from any previous run.

Solidifying generates noise. Place / solidify / scrap are host-authoritative.

### How this is enforced

Not by discipline. Structurally:

- `ui` may not import `gameplay`. `FortsMenuController` cannot reference `FortRuntime` because the
  module graph forbids it — `eslint-plugin-boundaries` fails the build.
- `CampaignSave` has no field capable of holding geometry. The absence is load-bearing.
- The Forts Menu is read-only history plus blueprint load. That is all it _can_ be.

## Consequences

**Good**

- The Power curve stays a spike. Every run earns its own absurdity.
- Losing a site costs the _position_, not hours of construction, so players keep taking risks.
- Save format stays small and migration-safe: no geometry, no versioned piece schemas.
- The `ui`/`gameplay` boundary has a real reason to exist, which makes it survive refactors.

**Costs**

- Players will ask for persistent forts. The answer is no, and it needs to be explained rather than
  argued each time — that is what this ADR is for.
- Rebuilding each run risks becoming a chore. Blueprints exist to make it a _plan_ rather than a
  repetition, and blueprint ergonomics are therefore not optional polish.
- Some fantasy is genuinely lost. That is the trade, made knowingly.
