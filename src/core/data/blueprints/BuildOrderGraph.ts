import type { BlueprintAsset, BlueprintPiece } from './BlueprintAsset';

/**
 * The order a blueprint's pieces can legally be solidified in.
 *
 * Two rules make this more than a list. Pieces need support (you cannot solidify a roof over
 * nothing), and solidifying is loud — so the order determines the shape of the run's noise curve,
 * not just its total. A plan that puts every loud piece first is a different decision from one that
 * walls the node before it makes any noise at all.
 *
 * That makes build order part of the blueprint's design, which is why it gets its own type rather
 * than being an implementation detail of the placer.
 */
export interface BuildStep {
  readonly piece: BlueprintPiece;
  /** Steps that must be solidified first. */
  readonly dependsOn: readonly number[];
  readonly loudness: number;
}

export class BuildOrderGraph {
  private constructor(readonly steps: readonly BuildStep[]) {}

  /** Derive support dependencies and loudness from a blueprint. */
  static from(_blueprint: BlueprintAsset): BuildOrderGraph {
    // TODO: implement per DESIGN.md — derive support from vertical adjacency, cost loudness per
    // piece from the piece definition, and reject a plan containing an unsupportable piece.
    throw new Error('BuildOrderGraph.from not implemented');
  }

  /** A valid solidify order. Throws if the plan contains a cycle or an unsupported piece. */
  topologicalOrder(): readonly BuildStep[] {
    // TODO: implement per DESIGN.md
    throw new Error('BuildOrderGraph.topologicalOrder not implemented');
  }

  /** Cumulative loudness after each step — the noise curve of executing this plan. */
  loudnessCurve(): readonly number[] {
    // TODO: implement per DESIGN.md — this is what BlueprintValidator reports to the player.
    throw new Error('BuildOrderGraph.loudnessCurve not implemented');
  }
}
