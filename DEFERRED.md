# Deliberately deferred

Everything here was in scope for a bigger game and is out of scope for v1
(starting zone, two classes, levels 1-10). Listed as it was cut, with what it would take.

## Systems

- **Multiplayer.** The bones are in: all input becomes a `Command`, all commands flow through
  the `CommandQueue` interface in `src/net/queue.ts`, and the sim is pure and deterministic.
  Not done: a `WsQueue` implementation, a Node server that owns the world, snapshot/delta
  encoding, client-side prediction and reconciliation, remote player entities.
- **Pathfinding.** Mobs walk in a straight line toward their target and will walk into rocks and
  trees. A navmesh or a grid A* over the heightmap is the follow-up.
- **Ranged and pet classes.** Hunter, Rogue and Priest exist only as data entries with three
  spells each. There is no energy regen tick, no combo points, no aimed-shot cast bar, no pets.
- **Resistances, dispels, immunities.** `School` is threaded through everything, but only physical
  armor mitigation is implemented; spell resistance is a binary hit roll with no partial resists.
- **Parry-haste, weapon skill, dual wield, off-hand penalties, weapon specialisations.**
- **Blocking value** — blocks subtract a flat 5 rather than a rolled block value.
- **Professions, reputation, trainers for weapon skills, mail, auction house, groups, instances.**
- **Spirit-of-redemption style death mechanics.** Death releases you to the graveyard at the
  village; there is no corpse run and no spirit healer.

## Content

- One zone, levels 1-10, five quests, seven mob types, one small cave with a named boss.
- Talents exist and spend correctly, but only `ap`, `crit` and `spellPower` effect kinds feed
  back into the stat pipeline; `costPct` and `critDamage` are stored and not yet read.
- No flight paths, no mounts, no inns beyond the rested-XP hook, no cooking or first aid.

## Presentation

- Characters are capsules, cones and boxes with vertex colours. No skeletal animation: models
  translate and rotate but do not walk, swing or die with animation.
- The cave is a dome and some rocks, not an interior with its own geometry and lighting.
- No sound at all.
- Terrain is one heightmap with vertex-colour splatting; there is no shader-based texture
  splatting, no normal maps and no water.

## Engineering

- Device performance tiering (reducing mob and grass counts on weak hardware) was explicitly
  out of scope for the mobile foundation; the touch input layer and responsive layout are in,
  the perf tiering is not.
- No zone editor. Spawns and NPCs are hand-written in `src/data/zone.starter.ts`.
- No save/load. Refreshing the page starts a new character.
