import type { Updatable } from '@core/time/RunClock';

/**
 * The player's weapon: cooldowns, damage, and the noise every shot makes.
 *
 * Owned by neither aiming system — both AutoFireSystem and ManualAimSystem ask this to fire, so the
 * cooldown is shared and switching views mid-fight cannot be used to double the rate of fire.
 *
 * In-run cards modify these values and are wiped at the end of the run (CardResetService). Anything
 * here that survived a run would be permanent progression wearing a card's clothes.
 */
export interface WeaponStats {
  readonly damage: number;
  readonly range: number;
  /** Seconds between shots. */
  readonly cooldown: number;
  /** Noise per shot, into the NoiseSystem. */
  readonly loudness: number;
  readonly projectileSpeed: number;
  readonly pierce: number;
}

export class WeaponController implements Updatable {
  private cooldownRemaining = 0;

  constructor(private stats: WeaponStats) {}

  get current(): WeaponStats {
    return this.stats;
  }

  get ready(): boolean {
    return this.cooldownRemaining <= 0;
  }

  /** Applied by CardEffectRunner. Always reset between runs. */
  applyStats(stats: WeaponStats): void {
    this.stats = stats;
  }

  /** Fire if off cooldown. Returns whether a shot actually left the barrel. */
  tryFire(
    _originX: number,
    _originY: number,
    _originZ: number,
    _dirX: number,
    _dirZ: number,
  ): boolean {
    // TODO: implement per DESIGN.md — spawn a pooled projectile, start the cooldown, and emit a
    // noise impulse of `stats.loudness`. Shots are loud; that coupling is not optional.
    throw new Error('WeaponController.tryFire not implemented');
  }

  update(dt: number): void {
    if (this.cooldownRemaining > 0) this.cooldownRemaining -= dt;
  }
}
