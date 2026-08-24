import type { NoiseSystem } from '@core/noise/NoiseSystem';
import type { Updatable } from '@core/time/RunClock';
import type { BuildAuthority } from './BuildAuthority';

/**
 * Turns ghosts into real fort pieces — and makes noise doing it.
 *
 * DESIGN.md: "Solidifying generates noise." That single coupling is what stops the Power pillar
 * from being free. A player who builds a ridiculous fort has, by definition, been loud for a long
 * time, and loudness brings the Sancients. The fort that protects you is the reason you need
 * protecting.
 *
 * Host-only, via BuildAuthority. Materials are spent HERE, not at ghost placement — cancelling a
 * plan costs nothing, committing to it costs everything.
 */
export class Solidifier implements Updatable {
  private readonly inProgress = new Map<string, number>();

  constructor(
    private readonly authority: BuildAuthority,
    private readonly noise: NoiseSystem,
    /** Card-modifiable multipliers. Both reset with the run. */
    private durationMultiplier = 1,
    private loudnessMultiplier = 1,
  ) {}

  setDurationMultiplier(value: number): void {
    this.durationMultiplier = value;
  }

  setLoudnessMultiplier(value: number): void {
    this.loudnessMultiplier = value;
  }

  /** Begin solidifying a ghost. Spends materials up front; there is no partial refund. */
  begin(_ghostId: string): void {
    // TODO: implement per DESIGN.md — ask the authority, deduct cost, start the timer, and register
    // a continuous NoiseEmitter for the duration. Building is loud while it happens, not after.
    void this.authority;
    void this.durationMultiplier;
    throw new Error('Solidifier.begin not implemented');
  }

  cancel(_ghostId: string): void {
    // TODO: implement per DESIGN.md — materials already spent are NOT returned. Committing is the
    // decision; changing your mind halfway does not undo the noise either.
    throw new Error('Solidifier.cancel not implemented');
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — advance timers, complete pieces, emit a noise impulse of
    // (piece loudness * loudnessMultiplier) on completion, and emit 'build/solidified'.
    void this.inProgress;
    void this.noise;
    void this.loudnessMultiplier;
    throw new Error('Solidifier.update not implemented');
  }
}
