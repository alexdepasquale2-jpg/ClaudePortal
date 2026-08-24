import type { SancientPowerTier } from '@core/data/factions/SancientDefinition';
import type { NoiseSystem } from '@core/noise/NoiseSystem';
import type { Updatable } from '@core/time/RunClock';
import type { SeededRandom } from '@core/utilities/SeededRandom';

/**
 * Decides when a Sancient arrives, and which one.
 *
 * The causal chain the whole game rests on:
 *
 *   build loudly -> loudness accumulates -> THIS class notices -> a Sancient arrives ->
 *   it jacks nearby machines -> the competence floor rises -> the clown turns and fires.
 *
 * Every link is legible to the player, which is why "should we turn on NNN?" is a real question
 * rather than superstition. Break any link and the Dread pillar becomes atmosphere.
 *
 * Sancients are RARE. This director must resist the temptation to send one whenever the player is
 * doing well: arrival is driven by accumulated loudness and safe-hold time, both of which the
 * player controls. A Sancient that arrives on a timer would make lighting a node pointless to think
 * about.
 */
export class SancientDirector implements Updatable {
  private elapsed = 0;
  private arrivals = 0;

  constructor(
    private readonly noise: NoiseSystem,
    private readonly tiers: readonly SancientPowerTier[],
    private readonly rng: SeededRandom,
    /** Extended by Pyron Chrome on a protected primary node. */
    private safeHoldSeconds: number,
  ) {}

  get arrivalCount(): number {
    return this.arrivals;
  }

  /** Chrome on a protected primary buys time here. This is chrome's second effect. */
  extendSafeHold(extraSeconds: number): void {
    this.safeHoldSeconds += extraSeconds;
  }

  /** Which tier, if any, is eligible at the current loudness. */
  eligibleTier(): SancientPowerTier | null {
    // TODO: implement per DESIGN.md — highest tier whose loudnessToSummon the run has passed;
    // null while still inside the safe hold window.
    void this.tiers;
    void this.safeHoldSeconds;
    throw new Error('SancientDirector.eligibleTier not implemented');
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md
    //  - accumulate elapsed; do nothing while inside safeHoldSeconds
    //  - read this.noise.loudness, find the eligible tier
    //  - roll arrival against the seeded rng so a run is reproducible
    //  - spawn away from the player and let it walk in: the approach is the warning
    void this.elapsed;
    void this.noise;
    void this.rng;
    throw new Error('SancientDirector.update not implemented');
  }

  reset(): void {
    this.elapsed = 0;
    this.arrivals = 0;
  }
}
