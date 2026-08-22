/**
 * economy.ts — pure economic core. No DOM, no clock, no storage.
 *
 * The numbers in here have been validated headlessly (10k+ ticks, greedy-bot
 * play, wide-vs-chain comparison). Treat K, E, GOAL and the archetype
 * production functions as fixed points: extend around them, don't re-derive
 * them.
 *
 * The load-bearing fact is that E < 1. A chain of doors applies
 *   log r_i = log raw_i + E * (log r_{i+1} - log K)
 * which converges to a fixed point — a single deep chain *saturates*. A node
 * with b live doors applies that term b times, so the recursion diverges as
 * soon as b*E > 1, i.e. from two doors upward. Depth is the win condition
 * because width is what makes depth compound.
 *
 * That argument only holds if raw_i is independent of what is below node i,
 * which is why a node banks its YIELD and not its OUTPUT:
 *
 *   yield  = rawProduction * globalMult          -- currency, spendable here
 *   output = rawProduction * doors * globalMult  -- what the parent's door
 *                                                   reads, and what the root
 *                                                   accumulates toward GOAL
 *
 * If a node banked its output instead, a deep chain would feed its own raw
 * production from its own door multipliers, raw_i would climb with depth, and
 * the fixed point would run away — single-chain grinding would beat wide
 * exploration outright. Two numbers per node is the price of the thesis.
 */

import type { Arch, GenData, NodeData } from './procgen';

/** Door normalisation constant. */
export const K = 12;
/** Base door exponent. Epochs raise this; nothing else may. */
export const BASE_E = 0.7;
/** Cascade generators exponentiate their door harder. */
export const CASCADE_E_MULT = 1.3;
/** Root lifetime output required to Collapse. */
export const GOAL = 1e9;
/** Parasitic generators scale their downstream neighbour's base by this. */
export const PARASITE_DEBUFF = 0.72;
/** Parasitic generators run this much hotter themselves. */
export const PARASITE_GAIN = 1.8;
/** A void node's own raw output multiplier, in exchange for its doors. */
export const VOID_RAW = 1.7;

/** Anything past this is treated as the ceiling; keeps Infinity out of saves. */
export const NUM_CEIL = 1e300;

export function clampFinite(x: number): number {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 0 : NUM_CEIL;
  if (x > NUM_CEIL) return NUM_CEIL;
  if (x < -NUM_CEIL) return -NUM_CEIL;
  return x;
}

// ---------------------------------------------------------------------------
// cost curve
// ---------------------------------------------------------------------------

/** Cost of buying `buyCount` more units of a generator that already owns `n`. */
export function cost(c0: number, gr: number, n: number, buyCount = 1): number {
  if (buyCount <= 0) return 0;
  return clampFinite((c0 * Math.pow(gr, n) * (Math.pow(gr, buyCount) - 1)) / (gr - 1));
}

export function genCost(g: GenData, buyCount = 1): number {
  return cost(g.c0, g.gr, g.n, buyCount);
}

/** Largest `buyCount` affordable with `currency`. Inverse of `cost`. */
export function maxBuy(c0: number, gr: number, n: number, currency: number): number {
  if (!(currency > 0)) return 0;
  const head = c0 * Math.pow(gr, n);
  if (!Number.isFinite(head) || head <= 0) return 0;
  const inner = 1 + (currency * (gr - 1)) / head;
  if (!Number.isFinite(inner) || inner <= 1) return 0;
  const k = Math.floor(Math.log(inner) / Math.log(gr));
  return Math.max(0, Number.isFinite(k) ? k : 0);
}

export function genMaxBuy(g: GenData, currency: number): number {
  return maxBuy(g.c0, g.gr, g.n, currency);
}

// ---------------------------------------------------------------------------
// production
// ---------------------------------------------------------------------------

/**
 * Per-generator base debuffs inside one node. Each parasitic generator scales
 * the effective base of the generator immediately after it (wrapping), which
 * is what makes a node full of parasites strictly worse than a node with one.
 */
export function genDebuffs(gens: readonly GenData[]): number[] {
  const d = new Array<number>(gens.length).fill(1);
  if (gens.length < 2) return d;
  for (let i = 0; i < gens.length; i++) {
    if (gens[i].arch === 'parasitic') {
      d[(i + 1) % gens.length] *= PARASITE_DEBUFF;
    }
  }
  return d;
}

/** Production of one generator, before any door multiplier. */
export function genProduction(
  g: GenData,
  debuff: number,
  t: number,
  siblingCount: number,
): number {
  if (g.n <= 0) return 0;
  const flat = g.n * g.base * debuff;
  switch (g.arch) {
    case 'steady':
      return flat;
    case 'pulse': {
      const freq = 0.28 + (g.seed % 5) * 0.08;
      const phase = g.seed % 7;
      return flat * (1 + 0.5 * Math.sin(t * freq + phase));
    }
    case 'decay':
      return flat / (1 + 0.012 * g.n);
    case 'resonant':
      return flat * (1 + Math.log10(1 + siblingCount) / 5);
    case 'parasitic':
      return flat * PARASITE_GAIN;
    case 'cascade':
      return flat;
    default:
      return flat;
  }
}

/** Sum of a node's generator output, before doors and the global multiplier. */
export function rawProduction(node: NodeData, t: number): number {
  const gens = node.gens;
  const debuffs = genDebuffs(gens);
  let live = 0;
  for (const g of gens) if (g.n > 0) live++;
  let sum = 0;
  for (let i = 0; i < gens.length; i++) {
    // a resonant generator hears every *other* live generator in the node
    const siblings = Math.max(0, live - (gens[i].n > 0 ? 1 : 0));
    sum += genProduction(gens[i], debuffs[i], t, siblings);
  }
  return clampFinite(sum);
}

/**
 * The door multiplier — the mechanic that makes depth mandatory.
 * A door with no live child contributes nothing (multiplier 1).
 */
export function doorMult(
  childRate: number,
  e: number,
  isCascadeDoor: boolean,
  k = K,
  cascadeMult = CASCADE_E_MULT,
): number {
  if (!(childRate > 0)) return 1;
  const exp = isCascadeDoor ? e * cascadeMult : e;
  return clampFinite(1 + Math.pow(childRate / k, exp));
}

export function doorExponentFor(arch: Arch, e: number, cascadeMult = CASCADE_E_MULT): number {
  return arch === 'cascade' ? e * cascadeMult : e;
}

// ---------------------------------------------------------------------------
// whole-tree rate computation
// ---------------------------------------------------------------------------

export interface RateParams {
  /** Simulation time in seconds, for pulse phase. */
  t: number;
  /** Permanent multiplier from collapses, achievements, and epoch laws. */
  globalMult: number;
  /** Effective door exponent for this epoch/genesis. */
  e: number;
  /** Epoch law: void nodes' raw multiplier. Defaults to VOID_RAW. */
  voidRaw?: number;
  /** Epoch law: door normalisation constant. Defaults to K. */
  k?: number;
  /** Epoch law: cascade door exponent multiplier. Defaults to CASCADE_E_MULT. */
  cascadeMult?: number;
}

export interface Tree {
  nodes: Record<string, NodeData>;
  /** Paths sorted deepest-first. Rebuilt only when the structure changes. */
  order: string[];
}

/** Both numbers for every node, keyed by path. */
export interface RateMaps {
  /** Amplified output: raw * doors * globalMult. Feeds parents and the goal. */
  output: Record<string, number>;
  /** Local yield: raw * globalMult. This is the currency a node banks. */
  yield: Record<string, number>;
}

export function emptyRateMaps(): RateMaps {
  return { output: Object.create(null), yield: Object.create(null) };
}

/** Sort paths deepest-first so a single pass computes every rate bottom-up. */
export function buildOrder(nodes: Record<string, NodeData>): string[] {
  const paths = Object.keys(nodes);
  paths.sort((a, b) => {
    const da = nodes[a].depth;
    const db = nodes[b].depth;
    if (da !== db) return db - da;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return paths;
}

/**
 * One bottom-up pass over every node. Results land in flat maps keyed by path;
 * nothing recurses per-generator per-frame, which is what lets the tree run
 * past ten thousand nodes.
 */
export function computeRates(
  tree: Tree,
  p: RateParams,
  out: RateMaps = emptyRateMaps(),
): RateMaps {
  const { nodes, order } = tree;
  const voidRaw = p.voidRaw ?? VOID_RAW;
  const k = p.k ?? K;
  const cascadeMult = p.cascadeMult ?? CASCADE_E_MULT;
  const output = out.output;
  const yields = out.yield;
  for (let i = 0; i < order.length; i++) {
    const path = order[i];
    const node = nodes[path];
    if (!node) continue;
    let raw = rawProduction(node, p.t);
    let doors = 1;
    if (node.anomaly === 'void') {
      raw *= voidRaw;
    } else {
      const gens = node.gens;
      for (let g = 0; g < gens.length; g++) {
        const childPathRef = gens[g].door;
        if (childPathRef === null) continue;
        const childRate = output[childPathRef];
        if (childRate === undefined || !(childRate > 0)) continue;
        doors *= doorMult(childRate, p.e, gens[g].arch === 'cascade', k, cascadeMult);
        if (doors > NUM_CEIL) {
          doors = NUM_CEIL;
          break;
        }
      }
    }
    const y = clampFinite(raw * p.globalMult);
    yields[path] = y;
    output[path] = clampFinite(y * doors);
  }
  return out;
}

/**
 * Advance the economy by `dt` seconds. Currency banks the yield; lifetime
 * accumulates the amplified output, because that is what GOAL measures.
 * Integrated with the values as of the start of the step, which is stable for
 * dt <= ~0.25s.
 */
export function tick(
  tree: Tree,
  dt: number,
  p: RateParams,
  out: RateMaps = emptyRateMaps(),
): RateMaps {
  const maps = computeRates(tree, p, out);
  if (dt <= 0) return maps;
  const { nodes, order } = tree;
  for (let i = 0; i < order.length; i++) {
    const path = order[i];
    const node = nodes[path];
    if (!node) continue;
    const banked = maps.yield[path] * dt;
    if (banked > 0) node.currency = clampFinite(node.currency + banked);
    const produced = maps.output[path] * dt;
    if (produced > 0) node.lifetime = clampFinite(node.lifetime + produced);
  }
  return maps;
}

// ---------------------------------------------------------------------------
// purchase helpers
// ---------------------------------------------------------------------------

export interface BuyResult {
  bought: number;
  spent: number;
}

/** Buy up to `want` units, spending only what the node actually holds. */
export function buy(node: NodeData, genIndex: number, want: number): BuyResult {
  const g = node.gens[genIndex];
  if (!g || want <= 0) return { bought: 0, spent: 0 };
  const affordable = Math.min(want, genMaxBuy(g, node.currency));
  if (affordable <= 0) return { bought: 0, spent: 0 };
  const spent = genCost(g, affordable);
  node.currency = clampFinite(node.currency - spent);
  g.n += affordable;
  g.bought += affordable;
  return { bought: affordable, spent };
}

/**
 * Manual channelling — the bootstrap tap. Reads YIELD, never output: a tap on
 * the root must not hand the player the whole tree's amplified income.
 */
export function channelGain(nodeYield: number): number {
  return 1 + nodeYield * 0.15;
}

/**
 * Marginal value of one more unit: added raw output per unit of cost. Used by
 * auto-buyers and the "best buy" hint so both agree on what greedy means.
 */
export function buyEfficiency(node: NodeData, genIndex: number): number {
  const g = node.gens[genIndex];
  if (!g) return 0;
  const debuffs = genDebuffs(node.gens);
  const gain = g.base * debuffs[genIndex] * (g.arch === 'parasitic' ? PARASITE_GAIN : 1);
  const c = genCost(g, 1);
  return c > 0 ? gain / c : 0;
}

/**
 * Units of a generator required before its door will open.
 *
 * This single number is what keeps the tree from degenerating. A door gated at
 * one unit would make "descend into a fresh node" the cheapest possible move
 * at every moment — a newborn node can always afford one tier-0 unit — so a
 * chain would out-expand a wide tree no matter what the door maths said.
 * Gating on units instead of price costs roughly the same span of a node's own
 * income at every tier, so opening a fourth door beside you and opening a
 * first door below you take about equally long. Width and depth expand at the
 * same speed; which one wins is then decided purely by the exponent.
 */
export const DOOR_UNITS = 10;

/** Is this generator's door openable? */
export function doorReady(g: GenData): boolean {
  return g.n >= DOOR_UNITS && g.door === null;
}
