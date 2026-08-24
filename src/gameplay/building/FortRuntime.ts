import type { Updatable } from '@core/time/RunClock';
import type { MaterialCounts, Vec3 } from '@core/types/Vocabulary';

/**
 * The fort, while it exists.
 *
 * ADR-0002, and the reason `ui` cannot import `gameplay`: this class holds geometry, health and
 * placement, and NONE of it survives the run. When the run resolves, this is discarded whole. The
 * campaign keeps only what the fort caused — ownership defended or lost, materials consumed,
 * production enabled, noise made.
 *
 * If you find yourself wanting to serialise a FortRuntime, that is the design saying no. Read
 * ADR-0002 before working around it: the Power pillar is a spike precisely because this is
 * temporary, and losing a site is survivable precisely because this was never an investment.
 *
 * FortsMenuController cannot reference this type. `npm run lint` enforces that.
 */
export interface FortPiece {
  readonly id: string;
  readonly pieceId: string;
  readonly position: Vec3;
  readonly rotation: number;
  /** Ghosts are placed but not yet real; only solidified pieces block, shoot or take damage. */
  readonly solidified: boolean;
  readonly health: number;
  readonly maxHealth: number;
}

export class FortRuntime implements Updatable {
  private readonly pieces = new Map<string, FortPiece>();
  private consumedThisRun: MaterialCounts | null = null;

  get pieceCount(): number {
    return this.pieces.size;
  }

  get solidifiedCount(): number {
    return [...this.pieces.values()].filter((piece) => piece.solidified).length;
  }

  /** Materials this fort has eaten. One of the few things that DOES reach the RunResult. */
  get consumed(): MaterialCounts | null {
    return this.consumedThisRun;
  }

  piece(id: string): FortPiece | undefined {
    return this.pieces.get(id);
  }

  add(piece: FortPiece): void {
    this.pieces.set(piece.id, piece);
  }

  remove(id: string): void {
    this.pieces.delete(id);
  }

  damage(_id: string, _amount: number): void {
    // TODO: implement per DESIGN.md — destroy at zero health; a destroyed piece refunds nothing.
    throw new Error('FortRuntime.damage not implemented');
  }

  /** Whether a position is supported enough to build on. */
  supportsPlacementAt(_position: Vec3): boolean {
    // TODO: implement per DESIGN.md
    throw new Error('FortRuntime.supportsPlacementAt not implemented');
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — advance solidify timers and per-piece module behaviour.
    throw new Error('FortRuntime.update not implemented');
  }

  /**
   * Called when the run resolves. Discards everything.
   * There is deliberately no `serialize()` on this class and there must never be one.
   */
  teardown(): void {
    this.pieces.clear();
    this.consumedThisRun = null;
  }
}
