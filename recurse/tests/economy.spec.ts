import { describe, expect, it } from 'vitest';
import {
  GOAL,
  K,
  BASE_E,
  buildOrder,
  buy,
  computeRates,
  cost,
  emptyRateMaps,
  doorMult,
  genDebuffs,
  maxBuy,
  rawProduction,
  tick,
} from '../src/engine/economy';
import { buildSimModel, computeRatesFlat } from '../src/engine/flat';
import { makeNode, rng, type GenData } from '../src/engine/procgen';
import { allFinite, freshEngine, greedyBuy, play } from './helpers';
import { doorReady } from '../src/engine/economy';

describe('cost curve', () => {
  it('cost of one unit is c0 * gr^n', () => {
    for (const gr of [1.05, 1.09, 1.13, 1.31]) {
      for (const n of [0, 1, 7, 40]) {
        expect(cost(9, gr, n, 1)).toBeCloseTo(9 * Math.pow(gr, n), 6);
      }
    }
  });

  it('is additive across split purchases', () => {
    const c0 = 12;
    const gr = 1.11;
    const whole = cost(c0, gr, 5, 9);
    const split = cost(c0, gr, 5, 4) + cost(c0, gr, 9, 5);
    expect(split).toBeCloseTo(whole, 6);
  });

  it('cost(0) is zero and negative counts are free', () => {
    expect(cost(9, 1.09, 3, 0)).toBe(0);
    expect(cost(9, 1.09, 3, -5)).toBe(0);
  });
});

describe('maxBuy round-trip', () => {
  const r = rng(12345);
  it('buys as much as possible and never more', () => {
    for (let trial = 0; trial < 3000; trial++) {
      const c0 = 1 + r() * 500;
      const gr = 1.01 + r() * 0.4;
      const n = Math.floor(r() * 200);
      const currency = Math.pow(10, r() * 14);
      const k = maxBuy(c0, gr, n, currency);
      expect(Number.isFinite(k)).toBe(true);
      expect(k).toBeGreaterThanOrEqual(0);
      if (k > 0) {
        // affordable...
        expect(cost(c0, gr, n, k)).toBeLessThanOrEqual(currency * (1 + 1e-9));
      }
      // ...and one more is not
      expect(cost(c0, gr, n, k + 1)).toBeGreaterThan(currency * (1 - 1e-9));
    }
  });

  it('returns 0 for non-positive currency', () => {
    expect(maxBuy(9, 1.09, 0, 0)).toBe(0);
    expect(maxBuy(9, 1.09, 0, -1)).toBe(0);
    expect(maxBuy(9, 1.09, 0, NaN)).toBe(0);
  });

  it('spending maxBuy leaves the node solvent', () => {
    const node = makeNode('', 4242, 0);
    node.currency = 1e6;
    const before = node.currency;
    const k = maxBuy(node.gens[0].c0, node.gens[0].gr, 0, node.currency);
    const res = buy(node, 0, k);
    expect(res.bought).toBe(k);
    expect(node.currency).toBeGreaterThanOrEqual(0);
    expect(node.currency).toBeLessThanOrEqual(before);
    expect(node.gens[0].n).toBe(k);
  });

  it('buy clamps to what the node can actually afford', () => {
    const node = makeNode('', 77, 0);
    node.currency = 20;
    const res = buy(node, 0, 1_000_000);
    expect(node.currency).toBeGreaterThanOrEqual(0);
    expect(res.bought).toBeLessThan(1_000_000);
  });
});

describe('door multiplier', () => {
  it('is 1 for a dead or missing child', () => {
    expect(doorMult(0, BASE_E, false)).toBe(1);
    expect(doorMult(-5, BASE_E, false)).toBe(1);
  });

  it('matches 1 + (childRate/K)^E', () => {
    expect(doorMult(K, BASE_E, false)).toBeCloseTo(2, 10);
    expect(doorMult(120, BASE_E, false)).toBeCloseTo(1 + Math.pow(10, 0.7), 10);
  });

  it('cascade doors use E*1.3', () => {
    expect(doorMult(120, BASE_E, true)).toBeCloseTo(1 + Math.pow(10, 0.7 * 1.3), 10);
    expect(doorMult(120, BASE_E, true)).toBeGreaterThan(doorMult(120, BASE_E, false));
  });

  it('is sublinear — a chain of doors converges to a fixed point', () => {
    // this is the whole reason single-chain grinding loses
    let r = 1e6;
    for (let i = 0; i < 400; i++) r = 50 * doorMult(r, BASE_E, false);
    const fixed = r;
    for (let i = 0; i < 400; i++) r = 50 * doorMult(r, BASE_E, false);
    expect(Math.abs(r - fixed) / fixed).toBeLessThan(1e-6);
    expect(fixed).toBeLessThan(1e9);
  });
});

describe('parasitic debuffs', () => {
  it('scales the following generator, wrapping', () => {
    const gens = [
      { arch: 'parasitic' },
      { arch: 'steady' },
      { arch: 'steady' },
      { arch: 'parasitic' },
    ] as GenData[];
    const d = genDebuffs(gens);
    expect(d[1]).toBeCloseTo(0.72, 12);
    expect(d[0]).toBeCloseTo(0.72, 12);
    expect(d[2]).toBe(1);
    expect(d[3]).toBe(1);
  });

  it('leaves a lone generator alone', () => {
    expect(genDebuffs([{ arch: 'parasitic' } as GenData])).toEqual([1]);
  });
});

describe('void anomaly', () => {
  it('receives no door multiplier but runs its own raw hotter', () => {
    const parent = makeNode('', 100, 0);
    parent.anomaly = null;
    const child = makeNode('0', 200, 1);
    child.gens[0].n = 100;
    parent.gens[0].n = 10;
    parent.gens[0].door = '0';
    const nodes = { '': parent, '0': child };
    const tree = { nodes, order: buildOrder(nodes) };
    const p = { t: 0, globalMult: 1, e: BASE_E };

    const normal = computeRates(tree, p).output[''];
    parent.anomaly = 'void';
    const asVoid = computeRates(tree, p).output[''];

    expect(asVoid).toBeCloseTo(rawProduction(parent, 0) * 1.7, 6);
    expect(normal).toBeGreaterThan(rawProduction(parent, 0));
    expect(asVoid).not.toBeCloseTo(normal, 3);
  });
});

describe('flat model parity', () => {
  it('agrees with the object implementation on random trees', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const engine = freshEngine(seed * 7919, 0);
      for (let i = 0; i < 600; i++) {
        engine.step(0.1, 0);
        for (const path of engine.order) greedyBuy(engine, path, 2);
        if (engine.order.length < 40) {
          outer: for (const path of engine.order) {
            const node = engine.state.run.nodes[path];
            for (let g = 0; g < node.gens.length; g++) {
              if (doorReady(node.gens[g])) {
                engine.openDoor(path, g, 0);
                break outer;
              }
            }
          }
        }
      }
      const p = engine.params();
      const objMaps = computeRates(engine.tree, p, emptyRateMaps());
      const model = buildSimModel(engine.tree);
      const flatYields = new Float64Array(model.nodeCount);
      const flatRates = computeRatesFlat(model, p, undefined, flatYields);
      expect(model.nodeCount).toBe(engine.order.length);
      for (let i = 0; i < model.nodeCount; i++) {
        for (const [a, b] of [
          [objMaps.output[model.paths[i]], flatRates[i]],
          [objMaps.yield[model.paths[i]], flatYields[i]],
        ]) {
          const denom = Math.max(1e-12, Math.abs(a));
          expect(Math.abs(a - b) / denom).toBeLessThan(1e-9);
        }
      }
    }
  });
});

describe('numeric stability', () => {
  it('survives 10k ticks of greedy play with no NaN or Infinity', () => {
    const engine = freshEngine(0xbeef, 0);
    for (let i = 0; i < 10_000; i++) {
      engine.step(0.1, 0);
      for (const path of engine.order) greedyBuy(engine, path, 2);
      if (i % 5 === 0 && engine.order.length < 200) {
        outer: for (const path of engine.order) {
          const node = engine.state.run.nodes[path];
          for (let g = 0; g < node.gens.length; g++) {
            if (doorReady(node.gens[g])) {
              engine.openDoor(path, g, 0);
              break outer;
            }
          }
        }
      }
      if (i % 500 === 0) expect(allFinite(engine)).toBe(true);
    }
    expect(allFinite(engine)).toBe(true);
    expect(engine.root.lifetime).toBeGreaterThan(0);
  });

  it('clamps rather than overflowing when the tree is absurd', () => {
    const engine = freshEngine(99, 0);
    // 40 nodes, each stuffed with an unreasonable number of units
    for (let i = 0; i < 4000; i++) {
      engine.step(0.05, 0);
      for (const path of engine.order) {
        const node = engine.state.run.nodes[path];
        node.currency = 1e250;
        for (let g = 0; g < node.gens.length; g++) engine.buy(path, g, 500);
      }
      if (engine.order.length < 40) {
        outer: for (const path of engine.order) {
          const node = engine.state.run.nodes[path];
          for (let g = 0; g < node.gens.length; g++) {
            if (doorReady(node.gens[g])) {
              engine.openDoor(path, g, 0);
              break outer;
            }
          }
        }
      }
    }
    expect(allFinite(engine)).toBe(true);
    for (const path of engine.order) {
      expect(engine.rates[path]).toBeLessThanOrEqual(1e300);
    }
  });

  it('tick with dt=0 changes nothing but still returns rates', () => {
    const engine = freshEngine(5, 0);
    engine.buy('', 0, 5);
    const before = engine.root.currency;
    const maps = tick(engine.tree, 0, engine.params(), emptyRateMaps());
    expect(engine.root.currency).toBe(before);
    expect(maps.output['']).toBeGreaterThan(0);
  });
});

describe('depth dominance', () => {
  // Both bots share one purchase policy and one node budget. The only thing
  // that differs is which door gets opened, so any gap is the exponent's.
  const BUDGET = 64;
  const MAX_TICKS = 30_000; // 50 minutes of simulated time at dt = 0.1s

  const wide = play(0xc0ffee, 'wide', { nodeBudget: BUDGET, maxTicks: MAX_TICKS, branch: 2 });
  const chain = play(0xc0ffee, 'chain', { nodeBudget: BUDGET, maxTicks: MAX_TICKS });

  it('wide exploration reaches the goal', () => {
    expect(wide.reachedGoal).toBe(true);
    expect(wide.deepest).toBeGreaterThanOrEqual(4);
  });

  it('an equal-node-count single chain does not, despite going far deeper', () => {
    expect(chain.nodes).toBeGreaterThanOrEqual(BUDGET - 2);
    expect(chain.deepest).toBeGreaterThan(wide.deepest * 5);
    expect(chain.reachedGoal).toBe(false);
    expect(chain.rootLifetime).toBeLessThan(GOAL);
  });

  it('wide wins by orders of magnitude, not by a margin', () => {
    // the chain burned the entire tick budget and still fell short
    expect(chain.simSeconds / wide.simSeconds).toBeGreaterThan(5);
    expect(wide.rootRate / Math.max(1, chain.rootRate)).toBeGreaterThan(100);
    // and it had not even reached a tenth of the goal
    expect(chain.rootLifetime / GOAL).toBeLessThan(0.5);
  });

  it('the chain saturates rather than merely being slow', () => {
    // A chain converges on a fixed point: past a certain depth, more depth
    // buys nothing. Compare a 20-node strand to a 64-node one.
    // Same tick budget, different node budgets, so the only difference is
    // how much depth the strand was allowed to reach.
    const short = play(0xc0ffee, 'chain', { nodeBudget: 8, maxTicks: MAX_TICKS });
    const long = play(0xc0ffee, 'chain', { nodeBudget: 64, maxTicks: MAX_TICKS });
    expect(long.deepest).toBeGreaterThan(short.deepest * 4);
    // five times the depth buys well under two orders of magnitude of rate
    expect(long.rootRate).toBeLessThan(short.rootRate * 100);
  });

  it('holds across several seeds and branching factors', () => {
    for (const seed of [1, 77, 4242, 2024]) {
      const c = play(seed, 'chain', { nodeBudget: BUDGET, maxTicks: 12_000 });
      for (const branch of [2, 3, 4]) {
        const w = play(seed, 'wide', { nodeBudget: BUDGET, maxTicks: 12_000, branch });
        expect(w.reachedGoal).toBe(true);
        expect(w.rootRate).toBeGreaterThan(c.rootRate * 50);
      }
      expect(c.reachedGoal).toBe(false);
    }
  });
});

describe('the goal is reachable by a fresh player', () => {
  it('a greedy bot collapses well inside fifteen minutes of simulated play', () => {
    for (const seed of [2024, 5, 909]) {
      const res = play(seed, 'wide', { nodeBudget: 200, maxTicks: 20_000, branch: 2 });
      expect(res.reachedGoal).toBe(true);
      expect(res.simSeconds).toBeLessThan(15 * 60);
    }
  });

  it('and the first door is affordable almost immediately', () => {
    const engine = freshEngine(31337, 0);
    let t = 0;
    while (t < 120 && !engine.root.gens.some((g) => doorReady(g))) {
      engine.step(0.1, 0);
      greedyBuy(engine, '', 3);
      t += 0.1;
    }
    expect(t).toBeLessThan(90);
  });
});
