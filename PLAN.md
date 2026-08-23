# Azeroth-Lite — build plan

A browser-playable slice of the World of Warcraft Classic core loop.
Three.js + TypeScript + Vite, hand-rolled: no engine, no ECS library, no UI framework.

## Definition of done (v1)

Within ten minutes of `npm run dev`: create a character, kill a boar, loot copper, reach
level 2, learn a spell from a trainer, accept and turn in a quest, and equip a green sword
that visibly changes the model. Everything else is scaffolding underneath that.

## Architecture

```
src/sim/     deterministic authoritative simulation — pure TS, zero three.js imports, 20Hz fixed timestep
src/render/  three.js; subscribes to sim state, never mutates it
src/ui/      DOM overlay + a tiny signal store
src/input/   InputSource interface -> Intent; keyboard/mouse and touch both implement it
src/net/     CommandQueue interface (LocalQueue today, WebSocket transport later)
src/data/    every gameplay number, as typed consts
tests/       determinism, attack table distribution, formula spot checks
```

Flow: `intent -> command queue -> sim.tick(commands) -> state -> render interpolates`.

Three rules hold this together:

1. **`src/sim` imports nothing from `three`.** It is plain data and arithmetic, runnable in Node.
   That is what makes the headless tests and (later) a server possible.
2. **The render and UI layers never write to sim state.** They read it and enqueue commands.
3. **Every command goes through `CommandQueue`.** Swapping `LocalQueue` for a WebSocket client is
   a transport change, not a rewrite.

Determinism: one seeded `mulberry32` stream lives on the world, and `src/sim` never calls
`Math.random`. Same seed + same command log ⇒ byte-identical combat log, asserted in
`tests/determinism.test.ts`. `?seed=1234` in the URL pins a world for reproducible runs.

## Data schemas

All in `src/data`, all typed against `src/sim/types.ts`:

| File | Holds |
| --- | --- |
| `formulas.ts` | every constant and derived-stat function, each commented with its Classic intent |
| `classes.ts` | class stat spreads, per-level growth, resource type, starting kit |
| `spells.ts` | cast time, cost, cooldown, range, school, `effects[]`, train cost, level |
| `auras.ts` | duration, stacks, periodic ticks, stat mods, break-on-damage |
| `items.ts` | slots, quality, item level, weapon damage/speed, durability, random suffixes |
| `mobs.ts` | level, health, armor, damage range, swing speed, social flag, loot table, shape |
| `loot.ts` | per-mob drop chances and money ranges |
| `quests.ts` | kill/collect/talk/explore objectives, rewards, prerequisite chains |
| `talents.ts` | three trees per class, tiers and dependency arrows |
| `zone.starter.ts` | spawn points, NPCs, roads, points of interest |

Retuning the whole game means editing these files and nothing else.

## Build order

1. **Sim core** — RNG, entities, attack table, threat, spells, auras, AI, loot, quests, XP.
2. **Combat log** — built second, not last. It prints every roll and is the primary debug tool.
3. **Render** — streamed heightmap chunks, procedural texture atlas, instanced grass and trees,
   primitives-only characters, day/night.
4. **UI** — unit frames, cast bars, action bar with keybinds and drag-to-slot, bags, character
   sheet, quest log, minimap, nameplates, pooled floating combat text.
5. **Classes** — Warrior and Mage fully (rage-on-damage-taken vs. mana-and-cast-time). Priest,
   Rogue and Hunter exist as data entries with three spells each and no code paths of their own.
6. **Mobile foundation** — a touch `InputSource` producing the same `Intent` as the keyboard,
   plus a responsive DOM layout. No gameplay branches on input type.

## Classic quirks deliberately preserved

- The attack table is **one sequential d100 roll**, not independent rolls per outcome.
- Glancing blows only against mobs 3+ levels above you; crushing blows only from mobs 4+ above.
- Melee crits multiply by 2.0; spell crits by 1.5.
- Rage comes mostly from damage *taken* and decays out of combat — you cannot bank it.
- Overpower is usable only in the five-second window after the target dodges you.
- Polymorph regenerates the target and breaks on any damage at all.
- Aura refresh resets duration flat: no pandemic window.
- Mobs leash, evade, full-heal and drop all threat when dragged too far from their spawn.
- Out-of-combat regen only; grey mobs award no experience.
