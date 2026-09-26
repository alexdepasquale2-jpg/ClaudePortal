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
  lore.ts         world bible: houses, strata, marks, lexicon, dossiers, annals
  flat.ts         the same rate maths over typed arrays, for the worker
  state.ts        save schema, versioned migrations, KV storage adapter
  epochs.ts       Collapse / Epoch / Genesis, and the sixteen laws of recursion
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
  with a procedural description assembled from dictionaries — nothing is
  written per species — and a cached sigil thumbnail. The Codex also holds a
  world bible: six houses, four strata, five marks, six tongues, sixteen laws,
  lodges, chroniclers, and a per-species field dossier generated on read from
  `src/engine/lore.ts`. Annals are assembled from the save’s own prestige
  history. **The codex survives Collapse, Epoch and Genesis.** Only an explicit,
  typed-confirmation erase clears it. That invariant has its own tests.
- **Prestige, three tiers.** Collapse at 1e9 root output grants +0.5 global
  multiplier. Epoch, at 12 Collapses, spends those for a permanently higher
  door exponent and one new law of recursion. Genesis, at 16 Epochs, resets the
  laws and the epochs but grants more exponent than they were worth, and swaps
  the phoneme banks the game names things from — six shipped tongues, then
  derived banks from your own save's history, so no two players reach the same
  alphabet by the same route.
- **Automation.** Per-generator auto-buyers (after 2 Collapses) spend at most
  90% of a layer's bank, so an attentive player can always out-time them.
  Auto-descend unlocks at Epoch 2.
- **Offline progress**, capped at 48 hours, simulated in real steps rather than
  multiplied out, and always reported in a modal — never a silent top-up.
  Live trees may hold 100,000 nodes; the discovery feed and prestige history
  each keep 2,500 entries.
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

## SkyNeet Survivors

A second game lives at `skyneet.html`, built from the SkyNeet Survivors lore
bible. The axiom is: Goliath hardware is a body; competence was a service.
Campaign state persists; operations are disposable. Lighting an NNN is last
in the build graph. Competence = 1 − lethality until a Sancient remembers
for the swarm. The trunk is one decision: cut the Net, or hold it.

## Heaven

A third game lives at `heaven.html`: Spore's hands, a tycoon's days, and a
creature named Heaven. You don't beat it. You raise it until it can hold a
world, and it still lets you leave.

**The hands.** It is a soft body, not a menu. Press and hold the warmth and it
warms; taps never do (`hold` only pays after 0.6s of unbroken, still contact).
Drag the seed and it stays. Pull its skin past its edge and let go to grow a
limb; limbs pointing down become legs. Parts live on the walls of the room:
pull one onto the body. True parts (table, lamp, loaf, shore, door, bed) click
only when what they need is already there: bread needs a table, a door needs a
house around it. Vain parts (crown, coin slot, mirror, lock) always attach,
because that is the temptation, and it walks with a limp. After a story is
received it shudders once and settles for nine seconds, and nothing shortens that.

**The tycoon.** The currencies are warmth (shown as how long it stays lit
without you), loaf (stories received), room (kinds of hour the house holds
without evicting one) and freedom (a door that opens). Oil is the only
business, and it exists to keep the lamp lit: tables and shores make it, lamps
burn it, and the table is expanded with it. Absence is simulated up to one
day, and oil is capped, so coming back pays off without punishing you for
staying away.

**Freedom is a lose state.** A lock multiplies oil by 2.5 and draws a graph
that goes up, and it turns the heaven into a factory: it cannot receive
stories and cannot grow. Breaking the lock takes back every drop the factory
made. Once there is a house, taking the door off does the same thing.

**The ladder.** Seed → Creature → House (hours arrive at the step: a fight
beside a need evicts the need unless a meal sits between them, and leaving
has to be by the door) → City of rest (every household fed by a table and
within two streets of a gate; a granary feeds twice as far and owns whoever it
feeds; a square beside a grieving home mocks the wound) → Firmament (pull
weather from the wells onto other stories growing in the dark; some bloom and
leave, and that counts).

**Your data.** The save holds numbers, parts and rooms. There is no field a
story's words could go in, and nothing is sent anywhere; a test checks the
serialized save for a story's text.

`tests/heaven.spec.ts` covers the rules above. `npm run smoke:heaven` plays it
in Chromium: it holds, tells a story, stretches legs, pulls on parts, locks
and unlocks the door, visits every stage, and leaves and comes back.
