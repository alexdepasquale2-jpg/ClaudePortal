import type { BuildAuthority } from './BuildAuthority';
import type { MaterialCounts, Vec3 } from '@core/types/Vocabulary';

/**
 * Places un-solidified ghosts.
 *
 * A ghost is free and silent — it costs nothing and makes no noise. The cost and the noise both
 * arrive at solidify time, which is what makes planning a fort and committing to one different
 * decisions.
 *
 * Placement rules follow the active view (camera and building are coupled): grid-snapped under the
 * cursor in top-down, along the look ray in third and first person.
 */
export class GhostPlacer {
  constructor(private readonly authority: BuildAuthority) {}

  /** Whether a ghost may go here. Cheap enough to call every frame for the placement preview. */
  canPlaceAt(_pieceId: string, _position: Vec3, _available: MaterialCounts): boolean {
    // TODO: implement per DESIGN.md — support, occupancy and affordability, via the authority.
    void this.authority;
    throw new Error('GhostPlacer.canPlaceAt not implemented');
  }

  /** Snap a raw world point to the build grid. */
  snapToGrid(_point: Vec3): Vec3 {
    // TODO: implement per DESIGN.md — blueprints are authored against this same grid.
    throw new Error('GhostPlacer.snapToGrid not implemented');
  }

  place(_pieceId: string, _position: Vec3, _rotation: number): string {
    // TODO: implement per DESIGN.md — returns the new ghost's id. Free and silent.
    throw new Error('GhostPlacer.place not implemented');
  }

  cancel(_ghostId: string): void {
    // TODO: implement per DESIGN.md — removing a ghost costs nothing; nothing was spent.
    throw new Error('GhostPlacer.cancel not implemented');
  }
}
