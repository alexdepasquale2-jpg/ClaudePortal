# ADR-0001: The campaign graph is the permanent record

- **Status:** Accepted
- **Date:** 2026-08-24

## Context

The game has no win state. It "simply progresses." Something has to accumulate, or repeated play is
just repeated play — and the design names it directly: _the permanent record is the shape of the
campaign graph the player has created through repeated failure and opportunistic success._

The obvious alternatives all fail the core concept:

- **Character progression as the record** — the player gets stronger, the world does not change. A
  run then has no effect on the next run's battlefield, only on the pawn walking into it.
- **Unlock lists as the record** — bragging rights with no spatial consequence. Losing a site would
  cost nothing you could point at on a map.
- **Full world simulation as the record** — everything persists, including the fort. Attractive, and
  fatal: see ADR-0002.

## Decision

A persistent `ArchipelagoGraph` of sites and edges is the single authoritative campaign state. Every
run resolves into a `RunResult`, which is applied to the graph. The graph holds ownership, per-site
state, stockpiles, pipelines, faction attitudes, radicalisation, feats, and resolved run history.

The graph is the only thing that persists. Everything else is either derived from it or session-only.

The World and Region menus render the graph directly. This is why `campaign` may not import
`gameplay`: campaign data must be fully renderable with no run machinery in existence.

## Consequences

**Good**

- Consequence, the tie-break pillar, has a home. Losing a site is visible on a map for the rest of the
  campaign.
- The Warfront needs no separate mode — it falls out of overlapping influence between graph nodes.
- Save format is small, diffable, and exportable. A campaign is a JSON document.
- Sites can be generated on demand from `(campaignSeed, siteId)` rather than stored, so the graph
  stays small no matter how large the archipelago gets.

**Costs**

- Every gameplay system that wants to matter must express itself as a graph mutation. "It felt great
  in the moment" is not persistence.
- Ownership flip rules become load-bearing design. They are currently one line of prose — see
  `GAPS.md`.
- Migrations are forever. The graph is the player's investment; a botched migration is the one bug
  that cannot be apologised away.
- A campaign can, in principle, be driven into an unrecoverable state. That needs a floor, and does
  not have one yet.
