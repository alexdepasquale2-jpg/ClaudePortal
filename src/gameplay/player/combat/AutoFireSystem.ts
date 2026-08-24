import type { Updatable } from '@core/time/RunClock';
import type { Vec3 } from '@core/types/Vocabulary';

/**
 * The Survivors spine.
 *
 * In top-down the player does not aim: targets are acquired and fired at automatically. This is
 * what makes the default view playable one-handed on a phone, and it is why the top-down camera is
 * steep — a shallow angle invites aiming, and once the player is aiming, auto-fire reads as the
 * game playing itself.
 *
 * In third-person it still runs, but biased by look direction (that bias is the "hybrid" part).
 * In first-person it is OFF; ManualAimSystem takes over entirely.
 *
 * Weapons fire loudly. Every shot feeds the noise field, so a player who clears a room aggressively
 * has made a Dread-pillar decision without ever touching the node.
 */
export interface Target {
  readonly id: string;
  readonly position: Vec3;
  readonly distance: number;
  /** Preferring a jacked Goliath is a legitimate strategy; the system must expose the flag. */
  readonly isJacked: boolean;
}

export class AutoFireSystem implements Updatable {
  private enabled = true;
  private range = 12;
  /** Unit direction to prefer when several targets are equally valid. Set by third-person look. */
  private bias: { x: number; z: number } | null = null;

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Disabled wholesale in first person. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Cards modify this. The modification dies with the run. */
  setRange(range: number): void {
    this.range = range;
  }

  setTargetingBias(bias: { x: number; z: number } | null): void {
    this.bias = bias;
  }

  /** Choose what to shoot. Extracted so targeting can be tested without a live scene. */
  selectTarget(_candidates: readonly Target[]): Target | null {
    // TODO: implement per DESIGN.md — nearest within range, tie-broken by targetingBias.
    void this.range;
    void this.bias;
    throw new Error('AutoFireSystem.selectTarget not implemented');
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — advance weapon cooldowns, select, fire, and emit shot noise
    // into the NoiseSystem. Must pool projectiles; this runs against hundreds of enemies.
    throw new Error('AutoFireSystem.update not implemented');
  }
}
