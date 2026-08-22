/**
 * Performance floor. The game must stay smooth with 10,000+ created nodes, so
 * the two things that run every frame — the rate pass and the tree flatten —
 * get a budget here.
 *
 * The bounds are deliberately loose (roughly 10x the numbers seen on a normal
 * machine) because CI runners vary wildly. They are here to catch an
 * algorithmic regression — someone making the rate pass quadratic, or the tree
 * view walk collapsed subtrees — not to benchmark hardware.
 */

import { describe, expect, it } from 'vitest';
import { buildOrder, computeRates, emptyRateMaps } from '../src/engine/economy';
import { buildSimModel, computeRatesFlat } from '../src/engine/flat';
import { flatten } from '../src/render/tree-view';
import { childPath, childSeed, makeNode, type NodeData } from '../src/engine/procgen';

/** A branching tree of at least `count` nodes, built without the Engine. */
function bigTree(count: number, branch: number): Record<string, NodeData> {
  const nodes: Record<string, NodeData> = {};
  const root = makeNode('', 12345, 0);
  nodes[''] = root;
  const queue: NodeData[] = [root];
  while (queue.length && Object.keys(nodes).length < count) {
    const parent = queue.shift()!;
    for (let g = 0; g < Math.min(branch, parent.gens.length); g++) {
      if (Object.keys(nodes).length >= count) break;
      const path = childPath(parent.path, g);
      const child = makeNode(path, childSeed(parent.seed, g), parent.depth + 1);
      for (const gen of child.gens) gen.n = 12 + (gen.seed % 40);
      nodes[path] = child;
      parent.gens[g].door = path;
      queue.push(child);
    }
  }
  for (const gen of root.gens) gen.n = 25;
  return nodes;
}

const NODES = 10_000;

describe(`${NODES} nodes`, () => {
  const nodes = bigTree(NODES, 3);
  const order = buildOrder(nodes);
  const tree = { nodes, order };
  const params = { t: 12.5, globalMult: 2.5, e: 0.72 };

  it('builds the tree the test expects', () => {
    expect(order.length).toBeGreaterThanOrEqual(NODES);
    let deepest = 0;
    for (const p of order) deepest = Math.max(deepest, nodes[p].depth);
    expect(deepest).toBeGreaterThan(5);
  });

  it('computes every rate in one bottom-up pass, well inside a frame budget', () => {
    const maps = emptyRateMaps();
    computeRates(tree, params, maps); // warm
    const t0 = performance.now();
    const reps = 20;
    for (let i = 0; i < reps; i++) computeRates(tree, params, maps);
    const per = (performance.now() - t0) / reps;
    console.log(`computeRates: ${per.toFixed(2)}ms for ${order.length} nodes`);
    expect(per).toBeLessThan(120);
    expect(Number.isFinite(maps.output[''])).toBe(true);
    expect(maps.output['']).toBeGreaterThan(0);
  });

  it('is faster still over the flat model, which is what the worker runs', () => {
    const model = buildSimModel(tree);
    const out = new Float64Array(model.nodeCount);
    const yields = new Float64Array(model.nodeCount);
    computeRatesFlat(model, params, out, yields); // warm
    const t0 = performance.now();
    const reps = 20;
    for (let i = 0; i < reps; i++) computeRatesFlat(model, params, out, yields);
    const per = (performance.now() - t0) / reps;
    console.log(`computeRatesFlat: ${per.toFixed(2)}ms for ${model.nodeCount} nodes`);
    expect(per).toBeLessThan(80);
  });

  it('scales linearly, not quadratically, in node count', () => {
    const small = { nodes: bigTree(1250, 3), order: [] as string[] };
    small.order = buildOrder(small.nodes);
    const time = (t: typeof tree): number => {
      const maps = emptyRateMaps();
      computeRates(t, params, maps);
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) computeRates(t, params, maps);
      return (performance.now() - t0) / 20;
    };
    const a = time(small);
    const b = time(tree);
    const nodeRatio = tree.order.length / small.order.length;
    console.log(`scaling: ${a.toFixed(2)}ms -> ${b.toFixed(2)}ms for ${nodeRatio.toFixed(1)}x nodes`);
    // linear would be ~nodeRatio; quadratic would be ~nodeRatio^2. Allow a wide
    // margin for timer noise but nowhere near the quadratic figure.
    expect(b).toBeLessThan(Math.max(2, a) * nodeRatio * 3);
  });

  it('flattens only what the tree view can actually see', () => {
    // collapsed: the walk must stop at the root's children, not visit 10k nodes
    const collapsed = flatten(nodes, { '': 1 });
    expect(collapsed.length).toBeLessThan(10);

    const expanded: Record<string, 1> = {};
    for (const p of order) expanded[p] = 1;
    const t0 = performance.now();
    const rows = flatten(nodes, expanded);
    const ms = performance.now() - t0;
    console.log(`flatten (all expanded): ${ms.toFixed(2)}ms for ${rows.length} rows`);
    expect(rows.length).toBe(order.length);
    expect(ms).toBeLessThan(120);

    // rows come out in depth-first order with parents before children
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.path !== '') {
        const cut = r.path.lastIndexOf('.');
        expect(seen.has(cut === -1 ? '' : r.path.slice(0, cut))).toBe(true);
      }
      seen.add(r.path);
    }
  });

  it('a fully collapsed 10k tree costs nothing to flatten', () => {
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) flatten(nodes, {});
    const per = (performance.now() - t0) / 500;
    console.log(`flatten (collapsed): ${per.toFixed(4)}ms`);
    expect(per).toBeLessThan(1);
  });
});
