import type { Updatable } from '@core/time/RunClock';
import type { Vec3 } from '@core/types/Vocabulary';

/**
 * Neetmon Gould. One body, on foot, underground.
 *
 * There is exactly one pawn and it is shared by all three views (DESIGN.md: "One pawn, three
 * live-switchable views"). Switching views must never move, duplicate or reset the pawn — the
 * camera changes, the body does not. That is why movement lives here and not in the view classes.
 *
 * Movement contributes to the noise field, which is why walking somewhere is a decision and not
 * just travel.
 */
export interface PawnState {
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Facing, in radians. Driven by movement in top-down, by look in third/first person. */
  readonly yaw: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly alive: boolean;
}

export class NeetmonController implements Updatable {
  /** Movement intent this tick, from whichever InputSource is active. Range -1..1 per axis. */
  private moveX = 0;
  private moveZ = 0;

  get state(): PawnState {
    // TODO: implement per DESIGN.md
    throw new Error('NeetmonController.state not implemented');
  }

  /** Called by the active input scheme. Never reads input itself — see InputSchemes. */
  setMoveIntent(x: number, z: number): void {
    this.moveX = x;
    this.moveZ = z;
  }

  setLookYaw(_yaw: number): void {
    // TODO: implement per DESIGN.md — ignored in top-down, where facing follows movement.
    throw new Error('NeetmonController.setLookYaw not implemented');
  }

  takeDamage(_amount: number, _source: string): void {
    // TODO: implement per DESIGN.md — death resolves the run as RunEndType 'Died'.
    throw new Error('NeetmonController.takeDamage not implemented');
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — integrate movement, clamp to the site, and emit movement
    // loudness into the NoiseSystem. Moving is not free; that is the point.
    void this.moveX;
    void this.moveZ;
    throw new Error('NeetmonController.update not implemented');
  }
}
