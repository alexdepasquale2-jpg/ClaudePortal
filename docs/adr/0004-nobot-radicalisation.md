# ADR-0004: Nobots radicalise over resolved operations and eventually betray

- **Status:** Accepted
- **Date:** 2026-08-24

## Context

The design calls Nobots _extremely important_. The player can arm them with scavenged neutrino tech;
newly armed they act as allies and distractors; over successive resolved operations they radicalise;
eventually they betray and want their own protected nodes. Sancients accelerate betrayal.

Arming a Nobot has to be a genuine decision, which means it needs a cost that is not immediate. A
permanent ally is a strictly-good pickup and therefore not a decision at all. A short-timer ally is a
consumable, which is a decision, but a small one.

The interesting shape is a debt: help now, paid for later, at a time you do not choose.

## Decision

Radicalisation is a per-group value on the **campaign graph**, not on a live entity. It:

- rises when an operation involving that group **resolves** — the debt is incurred by the run, not by
  the moment
- rises faster in the presence of Sancients
- crosses a threshold, at which point `BetrayalTrigger` fires
- after betrayal, the group becomes a faction that wants its own protected nodes, and will contest
  the player's

"They want your node" belongs primarily to Sancients and to post-betrayal Nobots. That phrase is the
shared identity of the two things that turn on you.

Because radicalisation lives on the graph, arming Nobots in one run changes what a _later_ run walks
into — which is the core concept applied to a faction rather than to terrain.

## Consequences

**Good**

- Arming is a real decision with a delayed, legible price.
- Ties the faction system to the Consequence pillar rather than leaving it a per-run mechanic.
- Gives Sancients a second axis of dread beyond competence: they do not only make Goliaths dangerous,
  they make your allies leave sooner.
- Betrayed groups become new contestants for ownership, so the graph gets more crowded the longer a
  campaign runs. The world gets harder because of what the player did.

**Costs**

- The rate is unspecified: per-operation, per-arming, or per-encounter, and whether it ever decays.
  See `GAPS.md`. This choice determines whether arming is a one-shot decision or a maintenance chore,
  and both are defensible.
- Requires a faction UI that makes an invisible accumulating number legible before it fires —
  `RadicalisationAlert` and the Faction Menu meters. A betrayal the player did not see coming reads
  as arbitrary, not as consequence.
- Post-betrayal Nobots need node-contesting behaviour, which is a second AI stance, not a flag flip.
