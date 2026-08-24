import type { TechNode } from '../data/tech/TechTree';
import type { MaterialCounts } from '../types/Vocabulary';

/**
 * Whether a tech node can be purchased yet.
 *
 * Three gates, all of which must pass: prerequisite nodes unlocked, prerequisite feats earned, and
 * stockpile sufficient. The feat gate is the interesting one — it means permanent progression is
 * bought with campaign materials but *unlocked* by having played a particular way, so a player
 * cannot simply grind scrap into the camera presets.
 */
export type UnlockRefusal =
  | { readonly reason: 'already-unlocked' }
  | { readonly reason: 'missing-tech'; readonly nodeIds: readonly string[] }
  | { readonly reason: 'missing-feats'; readonly featIds: readonly string[] }
  | { readonly reason: 'insufficient-materials'; readonly shortfall: MaterialCounts };

export type UnlockCheck =
  { readonly allowed: true } | { readonly allowed: false; readonly refusal: UnlockRefusal };

export class UnlockGate {
  constructor(private readonly nodes: readonly TechNode[]) {}

  check(
    _nodeId: string,
    _unlockedNodes: ReadonlySet<string>,
    _earnedFeats: ReadonlySet<string>,
    _stockpile: MaterialCounts,
  ): UnlockCheck {
    // TODO: implement per DESIGN.md — evaluate all three gates and report every failure, not just
    // the first: the Technology menu shows the player everything standing between them and a node.
    throw new Error('UnlockGate.check not implemented');
  }

  nodeById(id: string): TechNode | undefined {
    return this.nodes.find((node) => node.id === id);
  }
}
