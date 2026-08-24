import type { MaterialCounts, Vec3 } from '@core/types/Vocabulary';

/**
 * The catalogue of buildable pieces and what each costs.
 *
 * A piece's `loudness` is what Solidifier emits when it completes, so the cost of a fort is
 * genuinely two-dimensional: what it takes out of the stockpile, and how much attention it buys.
 * A cheap piece that is very loud is a real design space.
 */
export interface PieceDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly cost: MaterialCounts;
  /** Seconds to solidify. */
  readonly solidifyDuration: number;
  /** Noise impulse emitted on completion. */
  readonly loudness: number;
  readonly health: number;
  /** Footprint in grid cells. */
  readonly size: { readonly x: number; readonly y: number; readonly z: number };
  /** Whether it needs something beneath it. */
  readonly requiresSupport: boolean;
}

export class PiecePlacer {
  private readonly definitions = new Map<string, PieceDefinition>();

  register(definition: PieceDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  definition(id: string): PieceDefinition {
    const found = this.definitions.get(id);
    if (!found) throw new Error(`No piece definition "${id}"`);
    return found;
  }

  get all(): readonly PieceDefinition[] {
    return [...this.definitions.values()];
  }

  /** Cells a piece would occupy at a position and rotation. */
  footprintAt(_pieceId: string, _position: Vec3, _rotation: number): readonly Vec3[] {
    // TODO: implement per DESIGN.md
    throw new Error('PiecePlacer.footprintAt not implemented');
  }
}
