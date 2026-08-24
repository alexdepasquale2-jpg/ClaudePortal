import type { BlueprintAsset } from '@core/data/blueprints/BlueprintAsset';
import type { MaterialCounts } from '@core/types/Vocabulary';

/**
 * Loads a persisted blueprint into a live run as ghosts.
 *
 * DESIGN.md: "Blueprints can be planned between runs and loaded as ghosts."
 *
 * The rule this class exists to keep: a blueprint carries NO state from any previous run. Loading
 * one costs full price every time — no partial construction, no remembered damage, no discount for
 * having built it before. That is what keeps blueprints on the right side of ADR-0002. A blueprint
 * that remembered a previous run would be a persistent fort under another name.
 *
 * Loading places ghosts only. Ghosts are free and silent; the price and the noise arrive at
 * solidify time, exactly as they do for hand-placed pieces.
 */
export interface BlueprintLoadResult {
  readonly ghostIds: readonly string[];
  /** Full cost to solidify the whole plan. Always the full cost. */
  readonly totalCost: MaterialCounts;
  /** Pieces that could not be placed here — the site's geometry does not match the plan. */
  readonly rejected: readonly { readonly pieceId: string; readonly reason: string }[];
}

export class BlueprintLoader {
  /** Place a blueprint's pieces as ghosts, anchored at a world origin. */
  load(
    _blueprint: BlueprintAsset,
    _origin: { x: number; y: number; z: number },
    _rotation: number,
  ): BlueprintLoadResult {
    // TODO: implement per DESIGN.md — translate each piece from blueprint-local to world space,
    // place a ghost where it fits, and report the ones that do not rather than silently dropping
    // them. A plan that half-fits is information the player needs before committing.
    throw new Error('BlueprintLoader.load not implemented');
  }

  /** Whether the campaign stockpile could afford the whole plan. Advisory; loading is still free. */
  canAfford(_blueprint: BlueprintAsset, _available: MaterialCounts): boolean {
    // TODO: implement per DESIGN.md
    throw new Error('BlueprintLoader.canAfford not implemented');
  }
}
