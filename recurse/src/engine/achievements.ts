/**
 * achievements.ts — a bounded, hand-designed set of structural milestones.
 *
 * Deliberately *not* procedural: the Codex is the generated collection, and
 * these are the authored one. Each grants a small additive bonus to the global
 * multiplier, so the whole set is worth roughly two Collapses — flavour with a
 * nudge, never a shortcut.
 */

import { GOAL } from './economy';
import { SPECIES_COUNT, type NodeData } from './procgen';
import { COLLAPSES_PER_EPOCH } from './epochs';
import type { GameState } from './state';

export interface AchContext {
  state: GameState;
  nodeCount: number;
  codexCount: number;
  rootRate: number;
  deepestNow: number;
  /** Anomalies present anywhere in the current tree. */
  anomaliesSeen: Set<string>;
  maxUnitsInOneGen: number;
  openDoorsOnOneNode: number;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  /** Additive bonus to the global multiplier. */
  bonus: number;
  /** Hidden until unlocked. */
  secret?: boolean;
  test(c: AchContext): boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  // --- depth -------------------------------------------------------------
  { id: 'door1', name: 'First Door', desc: 'Open a door for the first time.', bonus: 0.02,
    test: (c) => c.state.meta.stats.doorsEverOpened >= 1 },
  { id: 'depth3', name: 'Shallow Water', desc: 'Reach depth 3.', bonus: 0.03,
    test: (c) => c.state.meta.stats.deepestDepth >= 3 },
  { id: 'depth6', name: 'Deep Strata', desc: 'Reach depth 6.', bonus: 0.05,
    test: (c) => c.state.meta.stats.deepestDepth >= 6 },
  { id: 'depth10', name: 'Abyssal', desc: 'Reach depth 10.', bonus: 0.08,
    test: (c) => c.state.meta.stats.deepestDepth >= 10 },
  { id: 'depth16', name: 'No Fixed Bottom', desc: 'Reach depth 16.', bonus: 0.12,
    test: (c) => c.state.meta.stats.deepestDepth >= 16 },
  { id: 'depth25', name: 'Turtles', desc: 'Reach depth 25.', bonus: 0.2,
    test: (c) => c.state.meta.stats.deepestDepth >= 25 },

  // --- width -------------------------------------------------------------
  { id: 'wide4', name: 'Fan Out', desc: 'Open every door on a single node.', bonus: 0.03,
    test: (c) => c.openDoorsOnOneNode >= 4 },
  { id: 'nodes50', name: 'Undergrowth', desc: 'Have 50 nodes alive at once.', bonus: 0.04,
    test: (c) => c.nodeCount >= 50 },
  { id: 'nodes500', name: 'Thicket', desc: 'Have 500 nodes alive at once.', bonus: 0.07,
    test: (c) => c.nodeCount >= 500 },
  { id: 'nodes5000', name: 'Canopy', desc: 'Have 5,000 nodes alive at once.', bonus: 0.15,
    test: (c) => c.nodeCount >= 5000 },
  { id: 'created10k', name: 'Prolific', desc: 'Create 10,000 nodes across all runs.', bonus: 0.1,
    test: (c) => c.state.meta.stats.nodesEverCreated >= 10000 },

  // --- volume ------------------------------------------------------------
  { id: 'buy100', name: 'Shopkeeper', desc: 'Buy 100 generator units.', bonus: 0.02,
    test: (c) => c.state.meta.stats.unitsEverBought >= 100 },
  { id: 'buy10k', name: 'Wholesaler', desc: 'Buy 10,000 generator units.', bonus: 0.05,
    test: (c) => c.state.meta.stats.unitsEverBought >= 10000 },
  { id: 'buy1m', name: 'Bulk Rate', desc: 'Buy 1,000,000 generator units.', bonus: 0.12,
    test: (c) => c.state.meta.stats.unitsEverBought >= 1e6 },
  { id: 'stack250', name: 'Monoculture', desc: 'Own 250 units of one generator.', bonus: 0.05,
    test: (c) => c.maxUnitsInOneGen >= 250 },
  { id: 'channel500', name: 'By Hand', desc: 'Channel 500 times.', bonus: 0.03,
    test: (c) => c.state.meta.stats.channels >= 500 },

  // --- anomalies ---------------------------------------------------------
  { id: 'anom_void', name: 'Nothing Below', desc: 'Find a Void anomaly.', bonus: 0.05,
    test: (c) => c.anomaliesSeen.has('void') || hasCodexAnomaly(c.state, 'void') },
  { id: 'anom_bloom', name: 'Fifth Limb', desc: 'Find a Bloom anomaly.', bonus: 0.05,
    test: (c) => c.anomaliesSeen.has('bloom') || hasCodexAnomaly(c.state, 'bloom') },
  { id: 'anom_all', name: 'Pathologist', desc: 'Find all four anomaly types.', bonus: 0.08,
    test: (c) =>
      (['mirror', 'echo', 'void', 'bloom'] as const).every((a) => hasCodexAnomaly(c.state, a)) },

  // --- codex -------------------------------------------------------------
  { id: 'codex1', name: 'First Specimen', desc: 'Log one species.', bonus: 0.01,
    test: (c) => c.codexCount >= 1 },
  { id: 'codex25', name: 'Quarter Sampled', desc: `Fill 25% of the codex (${Math.ceil(SPECIES_COUNT * 0.25)} species).`, bonus: 0.06,
    test: (c) => c.codexCount >= Math.ceil(SPECIES_COUNT * 0.25) },
  { id: 'codex50', name: 'Half Known', desc: 'Fill 50% of the codex.', bonus: 0.1,
    test: (c) => c.codexCount >= Math.ceil(SPECIES_COUNT * 0.5) },
  { id: 'codex100', name: 'Complete Taxonomy', desc: 'Fill the codex.', bonus: 0.25,
    test: (c) => c.codexCount >= SPECIES_COUNT },

  // --- prestige ----------------------------------------------------------
  { id: 'collapse1', name: 'Collapse', desc: 'Collapse once.', bonus: 0.03,
    test: (c) => c.state.meta.stats.totalCollapses >= 1 },
  { id: 'collapse12', name: 'Cycle', desc: `Collapse ${COLLAPSES_PER_EPOCH} times.`, bonus: 0.06,
    test: (c) => c.state.meta.stats.totalCollapses >= COLLAPSES_PER_EPOCH },
  { id: 'collapse100', name: 'Habit', desc: 'Collapse 100 times.', bonus: 0.12,
    test: (c) => c.state.meta.stats.totalCollapses >= 100 },
  { id: 'epoch1', name: 'New Rules', desc: 'Reach your first Epoch.', bonus: 0.08,
    test: (c) => c.state.meta.stats.totalEpochs >= 1 },
  { id: 'epoch8', name: 'Legislator', desc: 'Hold all eight laws at once.', bonus: 0.15,
    test: (c) => c.state.progress.laws.length >= 8 },
  { id: 'genesis1', name: 'Genesis', desc: 'Rewrite the language.', bonus: 0.3, secret: true,
    test: (c) => c.state.meta.stats.totalGenesis >= 1 },

  // --- speed / oddities --------------------------------------------------
  { id: 'fast5', name: 'Efficient', desc: 'Collapse in under 5 minutes.', bonus: 0.07,
    test: (c) => c.state.meta.stats.fastestCollapseMs > 0 && c.state.meta.stats.fastestCollapseMs < 5 * 60_000 },
  { id: 'fast90', name: 'Rehearsed', desc: 'Collapse in under 90 seconds.', bonus: 0.12,
    test: (c) => c.state.meta.stats.fastestCollapseMs > 0 && c.state.meta.stats.fastestCollapseMs < 90_000 },
  { id: 'overshoot', name: 'Overshoot', desc: 'Hold a root rate above the goal itself.', bonus: 0.1, secret: true,
    test: (c) => c.rootRate >= GOAL },
];

function hasCodexAnomaly(state: GameState, anomaly: string): boolean {
  for (const k of Object.keys(state.meta.codex)) {
    if (state.meta.codex[k].anomaly === anomaly) return true;
  }
  return false;
}

/** Total additive bonus from everything unlocked. Cheap enough to call often. */
export function achievementBonus(state: GameState): number {
  let sum = 0;
  for (const a of ACHIEVEMENTS) if (state.meta.achievements[a.id]) sum += a.bonus;
  return sum;
}

/** Evaluate every locked achievement; returns the ones that just unlocked. */
export function checkAchievements(c: AchContext, now: number): Achievement[] {
  const unlocked: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (c.state.meta.achievements[a.id]) continue;
    let ok = false;
    try {
      ok = a.test(c);
    } catch {
      ok = false;
    }
    if (ok) {
      c.state.meta.achievements[a.id] = now;
      unlocked.push(a);
    }
  }
  return unlocked;
}

/** Snapshot the per-tree facts the tests need, in one pass over the nodes. */
export function surveyTree(nodes: Record<string, NodeData>): {
  anomaliesSeen: Set<string>;
  maxUnitsInOneGen: number;
  openDoorsOnOneNode: number;
  nodeCount: number;
  deepestNow: number;
} {
  const anomaliesSeen = new Set<string>();
  let maxUnits = 0;
  let maxDoors = 0;
  let deepest = 0;
  let count = 0;
  for (const path of Object.keys(nodes)) {
    const n = nodes[path];
    count++;
    if (n.anomaly) anomaliesSeen.add(n.anomaly);
    if (n.depth > deepest) deepest = n.depth;
    let doors = 0;
    for (const g of n.gens) {
      if (g.n > maxUnits) maxUnits = g.n;
      if (g.door !== null) doors++;
    }
    if (doors > maxDoors) maxDoors = doors;
  }
  return {
    anomaliesSeen,
    maxUnitsInOneGen: maxUnits,
    openDoorsOnOneNode: maxDoors,
    nodeCount: count,
    deepestNow: deepest,
  };
}
