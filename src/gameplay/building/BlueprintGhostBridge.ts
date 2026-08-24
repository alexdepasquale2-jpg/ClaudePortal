import type { BlueprintAsset } from '@core/data/blueprints/BlueprintAsset';

/**
 * Keeps a loaded blueprint's ghosts and the plan they came from in step.
 *
 * Once a blueprint is loaded, the player edits ghosts in the world — moving, cancelling, adding.
 * This tracks which live ghost corresponds to which blueprint piece so the HUD can show progress
 * against the plan ("41 of 96 solidified") and so the build order's noise curve stays meaningful as
 * the player deviates from it.
 *
 * The mapping is session state. It dies with the run; the blueprint does not change.
 */
export class BlueprintGhostBridge {
  private readonly ghostToPiece = new Map<string, string>();
  private blueprint: BlueprintAsset | null = null;

  get loadedBlueprint(): BlueprintAsset | null {
    return this.blueprint;
  }

  bind(blueprint: BlueprintAsset, mapping: ReadonlyMap<string, string>): void {
    this.blueprint = blueprint;
    this.ghostToPiece.clear();
    for (const [ghostId, pieceId] of mapping) this.ghostToPiece.set(ghostId, pieceId);
  }

  pieceFor(ghostId: string): string | undefined {
    return this.ghostToPiece.get(ghostId);
  }

  release(ghostId: string): void {
    this.ghostToPiece.delete(ghostId);
  }

  /** Fraction of the plan actually solidified, for the HUD. */
  completion(): number {
    // TODO: implement per DESIGN.md
    throw new Error('BlueprintGhostBridge.completion not implemented');
  }

  clear(): void {
    this.ghostToPiece.clear();
    this.blueprint = null;
  }
}
