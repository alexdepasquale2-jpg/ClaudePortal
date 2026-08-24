import type { Updatable } from '@core/time/RunClock';

/**
 * Manual aiming, for first person and for anything the player explicitly triggers.
 *
 * Mutually exclusive with AutoFireSystem: exactly one of the two is enabled at a time, decided by
 * ViewSwitcher. Both running at once would mean the player's shots and the auto shots competing for
 * the same cooldown, which reads as the weapon randomly refusing to fire.
 *
 * Manual fire is more accurate and more dangerous to be doing when a Sancient arrives, because
 * aiming at one thing means not seeing the others.
 */
export class ManualAimSystem implements Updatable {
  private enabled = false;

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Where the crosshair currently points, in world space. */
  setAimRay(
    _origin: { x: number; y: number; z: number },
    _direction: { x: number; y: number; z: number },
  ): void {
    // TODO: implement per DESIGN.md
    throw new Error('ManualAimSystem.setAimRay not implemented');
  }

  setFiring(_firing: boolean): void {
    // TODO: implement per DESIGN.md
    throw new Error('ManualAimSystem.setFiring not implemented');
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — respect the weapon cooldown, raycast, apply damage, and emit
    // shot noise exactly as AutoFireSystem does. Firing manually is not quieter.
    throw new Error('ManualAimSystem.update not implemented');
  }
}
