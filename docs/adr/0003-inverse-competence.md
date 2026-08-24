# ADR-0003: Competence is inverse to lethality, and is never a property of the machine

- **Status:** Accepted
- **Date:** 2026-08-24

## Context

The setting's premise: the machines that inherited the surface _still carry full Goliath catalogs but
have forgotten how to use them_. A Goliath is enormously armed and enormously incompetent. That gap
is the joke, and the Panic pillar is the moment the joke stops.

The signature moment the design names: _a clownish high-lethality Goliath suddenly turns, acquires,
waits, and fires._

For that reversal to land, two things must be true at once:

1. The player must have learned to read a Goliath's armament as _harmless_, through repetition.
2. Nothing about the machine can change at the moment of reversal — only whether something is telling
   it how to aim.

If competence were a stat on the enemy, designers would author competent Goliaths, players would
learn to read the stat instead of the armament, and the reversal would become just another enemy
type.

## Decision

**Lethality is a property of the machine. Competence is not.**

- A `GoliathCatalogEntry` describes armament and lethality. It has **no** accuracy, skill, or
  competence field. This is enforced by the type.
- Competence is computed at runtime by `LethalityCompetence` from the **local competence floor** at
  the Goliath's position.
- The floor is raised by: a `SancientJack` (temporarily), overlapping territory influence between
  lit/owned sites (the Warfront), and permanent jacks (permanently, locally).
- Higher catalog lethality correlates with _lower_ baseline competence. The most dangerous thing in
  the room is the most useless — until it isn't.

The Warfront needs no separate mode: it is just the region where floors are elevated because
influence volumes overlap.

## Consequences

**Good**

- The reversal is systemic rather than scripted. Any Goliath can become the scary one.
- Sancients get their whole identity from one number: personally weak, catastrophic in effect.
- The Warfront falls out for free — overlapping influence _is_ rising competence.
- A single stat block serves both the comedy and the terror, so authoring stays cheap.

**Costs**

- Readability. A player must be able to see that a floor has risen, or the reversal reads as a bug.
  `CompetenceWarning` in the HUD exists for exactly this and is not optional polish.
- Balance is now two-dimensional and coupled: buffing lethality makes the clown funnier _and_ the
  jacked version deadlier.
- The floor maths — curve, units, how multiple sources combine — is unspecified. See `GAPS.md`. Until
  it is chosen, `LethalityCompetence` stays a stub rather than acquiring a placeholder curve that
  would silently become the design.
