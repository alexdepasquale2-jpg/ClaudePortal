# Azeroth-Lite

A browser-playable slice of the World of Warcraft Classic core loop, built from primitives:
Three.js + TypeScript + Vite, a hand-rolled deterministic simulation, and a plain DOM interface.

```bash
npm install
npm run dev     # http://localhost:5173 — no other setup steps
npm test        # determinism, attack table, formulas
```

## The ten-minute loop

Create a character, walk east, kill a boar, loot copper, take Marshal Hale's quest, hit level 2,
learn Rend (Warrior) or Frostbolt (Mage) from Varn Ironquill, turn the quest in, and go take the
green sword off the kobolds in Candlerock Cave.

## Controls

| | |
| --- | --- |
| Move | `W` `A` `S` `D`, `Q`/`E` strafe, arrow keys |
| Look | right-mouse drag; wheel zooms |
| Target | left-click a unit, or `Tab` for the nearest |
| Abilities | `1` – `0`; drag spells from the spellbook onto the bar |
| Loot / talk | `F` |
| Panels | `B` bags · `C` character · `L` quests · `P` spellbook · `N` talents · `Esc` closes |
| Touch | virtual joystick, drag to look, pinch to zoom, tap to target, on-screen Target/Use |

`?seed=1234` pins the world seed; `?class=mage&name=Elowyn` skips character creation.

## Layout

`src/sim` is the authoritative simulation: pure TypeScript, no Three.js, 20Hz fixed timestep,
one seeded RNG. `src/render` draws it and never writes to it. `src/ui` is DOM. `src/input` turns
keyboard and touch into the same `Intent`. `src/net` is the command queue a WebSocket server
would slot into. `src/data` holds every gameplay number.

See [PLAN.md](PLAN.md) for the architecture and the Classic quirks that were deliberately kept,
and [DEFERRED.md](DEFERRED.md) for what was left out of v1.
