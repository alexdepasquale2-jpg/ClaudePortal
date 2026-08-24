# Networking

The game ships single-player and local. This document exists because the design locks one networking
rule, and building as if it does not exist would make it expensive to honour later.

## The locked rule

**Host-only place / solidify / scrap.**

Every mutation of a fort goes through the `BuildAuthority` interface in
`src/gameplay/building/`. Today the only implementation is `LocalHostAuthority`, which answers
immediately. There is no second implementation, and there is no branch anywhere in the codebase that
asks "am I the host?" — code either holds a `BuildAuthority` or it cannot build.

That means adding a networked implementation later is one class, not a refactor.

## What is authoritative

Anything that can flip ownership or spend a stockpile:

- placing a ghost, solidifying it, scrapping a piece
- NNN activation and Pyron Chrome installation
- production ticks and output queues
- extraction resolution and the resulting `RunResult`

## What is not

Camera, view mode, HUD, input feel, VFX, audio, blueprint editing in the sandbox. These are local to
each viewer by definition and must never round-trip.

## What is deliberately unsolved

- Transport, lobbies, matchmaking, reconnection — none of it is designed yet.
- Whether co-op runs share a campaign graph or each player keeps their own, and what happens to
  ownership flips when they disagree. This is a **design** question, not a networking one, and it is
  logged in `GAPS.md`.
- Determinism is a prerequisite (`SeededRandom` is already deterministic and serialisable), but
  lockstep vs. state-sync has not been chosen.

Do not build toward a guess. Keep mutations behind `BuildAuthority` and the option stays open.
