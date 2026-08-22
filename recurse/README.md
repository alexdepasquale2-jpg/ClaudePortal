# RECURSE

An incremental game about one generative function called on itself at every
scale, with no fixed depth limit.

A **layer** is a currency and four or five generators. Every generator has a
**door**. Opening a door descends into a brand new layer — same rules, new
seed, new name, new colour, new behaviour. A layer's output is multiplied,
without bound, by whatever is built beneath each of its doors.

Depth is not flavour. It is the win condition, and the maths makes going wide
the only way to get there.

```
npm install
npm run dev      # play it
npm test         # 100 tests: economy, procgen, state, performance
npm run build    # static PWA into dist/
npm run smoke    # optional: end-to-end browser run (needs Playwright)
```

## Why width beats depth

The door multiplier is

```
doorMult(childOutput) = 1 + (childOutput / K) ^ E      K = 12, E = 0.7
```

so a layer with live doors produces

```
output = rawProduction * PRODUCT(doorMult for each door) * globalMult
```

Take logs. A layer with `b` live doors satisfies roughly

```
log r_i  =  log raw_i  +  b * E * (log r_i+1 - log K)
```

With `E = 0.7`, a single chain (`b = 1`) has a coefficient of 0.7 — a
contraction. Every extra level multiplies the previous level's log by less than
one and adds a constant, so the chain converges on a fixed point and stops
paying. Two doors on the same layer make the coefficient 1.4, and the recursion
runs away super-exponentially.

Measured, with both bots sharing one purchase policy and one 64-node budget so
that tree shape is the only variable:

| strategy | reached 1e9 | depth | root output at the end |
| --- | --- | --- | --- |
| wide (branch 2) | yes, in 290–460s | 5 | ~1e8/s |
| single chain | no, after 3000s | 63 | ~5e4/s |

The chain went twelve times deeper, ran ten times longer, and produced under a
tenth of the goal. `tests/economy.spec.ts` asserts all of this, across several
seeds and branching factors.

### Two decisions that hold the thesis up

Both are documented at their definitions, because both look like ordinary
implementation details and neither is.

**A layer banks its yield, not its output.**

```
yield  = rawProduction * globalMult            spendable, here, by this layer
output = rawProduction * doors * globalMult    what the parent's door reads
```

The fixed-point argument only works if `raw_i` is independent of what is below
node `i`. If a layer banked its amplified output instead, a deep chain would
fund its own raw production out of its own door multipliers, `raw` would climb
with depth, and single-chain grinding would beat wide exploration outright.

**Doors are gated on units owned, not on price.** A door needs ten of its
generator. Gating on price instead would make "descend into a fresh layer" the
cheapest move available at every single moment — a newborn layer can always
afford one tier-0 unit — so the tree would degenerate into a chain no matter
what the player intended. Gating on units costs about the same span of a
layer's own income at every tier, so opening a fourth door beside you and a
first door below you take about equally long. Width and depth expand at the
same speed; the exponent decides which one wins.

## Layout

```
src/engine/     pure, no DOM, no clock, no storage
  economy.ts      cost, maxBuy, archetype production, door multiplier, tick
  procgen.ts      FNV-1a + mulberry32, word grammar, archetypes, anomalies,
                  the 6 x 4 x 5 = 120 species taxonomy
  flat.ts         the same rate maths over typed arrays, for the worker
  state.ts        save schema, versioned migrations, KV storage adapter
  epochs.ts       Collapse / Epoch / Genesis, and the eight laws of recursion
  actions.ts      the Engine — purchases, descent, codex, automation, offline
  achievements.ts a bounded authored set, worth under six Collapses in total
src/render/     canvas, DOM, palette
  sigil.ts        fractal / spiral / rings, one shared {seed, growth, depth, hue}
  tree-view.ts    virtualized; mounts only the rows on screen
  ritual.ts       the three reset ceremonies, plus audio and haptics
  palette.ts      hue -> accent that clears WCAG AA at all 360 hues
src/workers/    sim.worker.ts — rate computation off the main thread
```

The engine never imports from `render`. `main.ts` is the only file that knows
about both.

## Systems

- **Codex.** Every layer is classified from its dominant archetype, depth tier
  and anomaly into one of 120 species. First encounters are logged permanently
  with a procedural description assembled from four dictionaries — nothing is
  written per species — and a cached sigil thumbnail. **The codex survives
  Collapse, Epoch and Genesis.** Only an explicit, typed-confirmation erase
  clears it. That invariant has its own tests.
- **Prestige, three tiers.** Collapse at 1e9 root output grants +0.5 global
  multiplier. Epoch, at 12 Collapses, spends those for a permanently higher
  door exponent and one new law of recursion. Genesis, at 8 Epochs, resets the
  laws and the epochs but grants more exponent than they were worth, and swaps
  the phoneme banks the game names things from — derived from your own save's
  history, so no two players reach the same alphabet by the same route.
- **Automation.** Per-generator auto-buyers (after 2 Collapses) spend at most
  90% of a layer's bank, so an attentive player can always out-time them.
  Auto-descend unlocks at Epoch 2.
- **Offline progress**, capped at 12 hours, simulated in real steps rather than
  multiplied out, and always reported in a modal — never a silent top-up.
- **Save export/import** as JSON, treated as the primary defence against data
  loss. Import runs through the same hostile-input hydration as a normal load:
  a corrupt layer cannot inject NaN into the rate pass.
- **Seed sharing** via `?seed=`. Child seeds are derived deterministically from
  the parent, so the same root grows the same tree for everybody.

## Accessibility and performance

`prefers-reduced-motion` is honoured (and overridable): rituals still appear
and still announce their result, they just do not animate. Node hues are
procedural, so accent colours are computed by bisecting lightness until the
contrast target is actually met against the surface the text sits on — a fixed
lightness fails somewhere on the wheel no matter where you set it. A test walks
all 360 hues against both surfaces. Everything works by keyboard and by touch.

Measured at 10,000 nodes (`tests/perf.spec.ts`): the full bottom-up rate pass
costs 4.4ms, the flat/worker version 2.7ms, and both scale linearly. The tree
view flattens only expanded subtrees, so a collapsed 10k tree costs 0.4µs.
Rate computation moves to a Web Worker past 1,500 nodes; the worker owns the
tree shape and generator counts while the main thread keeps currency, so it can
never drift from the save.

## Non-goals

No ads, no purchases, no backend. The game installs as a PWA and plays fully
offline after first load.
