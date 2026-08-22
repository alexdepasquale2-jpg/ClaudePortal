/**
 * Headless play harness. The comparative wide-vs-chain test is the reason this
 * exists: both strategies get the same node budget, the same greedy purchase
 * rule, and the same tick loop, so the only variable is tree shape.
 */

import { Engine } from '../src/engine/actions';
import { buyEfficiency, doorReady, genMaxBuy } from '../src/engine/economy';
import { newGame, type GameState } from '../src/engine/state';

export function freshState(seed: number, now = 0): GameState {
  return newGame(seed, now);
}

export function freshEngine(seed: number, now = 0): Engine {
  const e = new Engine(freshState(seed, now));
  e.noteAllSpecies(now);
  e.refreshRates();
  return e;
}

/**
 * The purchase policy both strategies share. Two parts, in order:
 *
 *  1. seed one unit of every generator that has none. A generator with zero
 *     units has no openable door, so pure marginal-efficiency buying never
 *     unlocks anything past tier 0 — it degenerates into a chain no matter
 *     what the descent policy says.
 *  2. greedy marginal output-per-cost for whatever is left.
 */
export function greedyBuy(engine: Engine, path: string, rounds = 4): number {
  const node = engine.state.run.nodes[path];
  if (!node) return 0;
  let bought = 0;
  for (let i = 0; i < node.gens.length; i++) {
    if (node.gens[i].n === 0) bought += engine.buy(path, i, 1);
  }
  for (let r = 0; r < rounds; r++) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < node.gens.length; i++) {
      if (genMaxBuy(node.gens[i], node.currency) < 1) continue;
      const score = buyEfficiency(node, i);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    const got = engine.buy(path, best, 1);
    if (got <= 0) break;
    bought += got;
  }
  return bought;
}

export type Strategy = 'wide' | 'chain';

export interface PlayResult {
  ticks: number;
  simSeconds: number;
  reachedGoal: boolean;
  rootLifetime: number;
  rootRate: number;
  nodes: number;
  deepest: number;
}

/**
 * Run a greedy bot until it hits GOAL or runs out of ticks.
 *
 * `wide`  — open every door that becomes available, breadth-first.
 * `chain` — only ever open one door, always on the deepest node, so the tree
 *           is a single strand of the same node budget.
 */
export function play(
  seed: number,
  strategy: Strategy,
  opts: {
    nodeBudget: number;
    maxTicks: number;
    dt?: number;
    goal?: number;
    /** Doors the wide bot opens per node before moving to the next level. */
    branch?: number;
  } = { nodeBudget: 64, maxTicks: 40_000 },
): PlayResult {
  const branch = opts.branch ?? 2;
  const dt = opts.dt ?? 0.1;
  const goal = opts.goal ?? 1e9;
  const engine = freshEngine(seed, 0);
  let ticks = 0;

  for (; ticks < opts.maxTicks; ticks++) {
    engine.step(dt, 0);

    // buy everywhere, greedily
    for (const path of engine.order) greedyBuy(engine, path, 3);

    // descend
    if (engine.order.length < opts.nodeBudget) {
      if (strategy === 'wide') {
        // Strictly breadth-first. A door is only opened at the shallowest
        // depth that still has *any* unopened door — including ones that are
        // not affordable yet. Without that wait, "open the shallowest ready
        // door" degenerates into a chain: the only generator a new node can
        // afford is tier 0, so its door is the only ready one in the tree.
        const open = (n: { gens: { door: string | null }[] }) =>
          n.gens.reduce((a, g) => a + (g.door === null ? 0 : 1), 0);
        let frontier = Infinity;
        for (const path of engine.order) {
          const node = engine.state.run.nodes[path];
          if (node.depth >= frontier) continue;
          if (open(node) < branch) frontier = node.depth;
        }
        let bestPath: string | null = null;
        let bestGen = -1;
        for (const path of engine.order) {
          const node = engine.state.run.nodes[path];
          if (node.depth !== frontier || open(node) >= branch) continue;
          for (let g = 0; g < node.gens.length; g++) {
            if (doorReady(node.gens[g])) {
              bestPath = path;
              bestGen = g;
              break;
            }
          }
          if (bestPath !== null) break;
        }
        if (bestPath !== null) engine.openDoor(bestPath, bestGen, 0);
      } else {
        // single strand: extend only the deepest node, one door ever
        let deepPath: string | null = null;
        let deepGen = -1;
        let deepest = -1;
        for (const path of engine.order) {
          const node = engine.state.run.nodes[path];
          if (node.depth < deepest) continue;
          if (node.gens.some((g) => g.door !== null)) continue;
          for (let g = 0; g < node.gens.length; g++) {
            if (doorReady(node.gens[g])) {
              deepPath = path;
              deepGen = g;
              deepest = node.depth;
              break;
            }
          }
        }
        if (deepPath !== null) engine.openDoor(deepPath, deepGen, 0);
      }
    }

    if (engine.root.lifetime >= goal) {
      ticks++;
      break;
    }
  }

  return {
    ticks,
    simSeconds: ticks * dt,
    reachedGoal: engine.root.lifetime >= goal,
    rootLifetime: engine.root.lifetime,
    rootRate: engine.rates[''] ?? 0,
    nodes: engine.order.length,
    deepest: engine.state.run.deepest,
  };
}

export function allFinite(engine: Engine): boolean {
  for (const path of engine.order) {
    const n = engine.state.run.nodes[path];
    if (!Number.isFinite(n.currency) || Number.isNaN(n.currency)) return false;
    if (!Number.isFinite(n.lifetime) || Number.isNaN(n.lifetime)) return false;
    const r = engine.rates[path];
    if (r === undefined || Number.isNaN(r) || !Number.isFinite(r)) return false;
    for (const g of n.gens) {
      if (!Number.isFinite(g.n) || !Number.isFinite(g.base)) return false;
    }
  }
  return true;
}
