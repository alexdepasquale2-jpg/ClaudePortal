import type { EventBus } from '../events/EventBus';
import type { Vec3 } from '../types/Vocabulary';
import type { HeardNoise, HearingComponent } from './HearingComponent';
import type { NoiseEmitter, NoiseImpulse } from './NoiseEmitter';
import type { Updatable } from '../time/RunClock';

/**
 * The noise field, and the accumulated loudness of a run.
 *
 * This is the machinery under the Dread pillar. DESIGN.md: "Building is loud. Loudness brings the
 * Sancients." There are two quantities here and they must not be confused:
 *
 *  - the INSTANTANEOUS field, sampled at a position: what a Goliath hears right now
 *  - the ACCUMULATED loudness of the run: what the SancientDirector reads to decide whether to send
 *    someone. It rises with sustained noise and decays with silence, so a player who goes quiet is
 *    genuinely safer — otherwise "should we turn on NNN?" has only one answer.
 *
 * Pyron Chrome reduces a protected primary NNN's contribution at the emitter, not here.
 */
export class NoiseSystem implements Updatable {
  private readonly emitters = new Map<string, NoiseEmitter>();
  private readonly listeners = new Map<string, HearingComponent>();
  private readonly impulses: NoiseImpulse[] = [];

  private accumulated = 0;
  private crossedThresholds = new Set<number>();

  constructor(
    private readonly events: EventBus,
    /** Ascending loudness values that, once crossed, escalate Sancient attention. */
    private readonly thresholds: readonly number[] = [],
  ) {}

  /** Total loudness of the run so far. This is what the SancientDirector reads. */
  get loudness(): number {
    return this.accumulated;
  }

  registerEmitter(emitter: NoiseEmitter): () => void {
    this.emitters.set(emitter.id, emitter);
    return () => this.emitters.delete(emitter.id);
  }

  registerListener(listener: HearingComponent): () => void {
    this.listeners.set(listener.id, listener);
    return () => this.listeners.delete(listener.id);
  }

  /** A one-off noise: a shot, an impact, a wall solidifying. */
  emitImpulse(impulse: NoiseImpulse): void {
    this.impulses.push(impulse);
    this.events.emit('noise/emitted', {
      position: impulse.position,
      loudness: impulse.loudness,
      source: impulse.source,
    });
  }

  /** Instantaneous loudness at a point, summing active emitters and this tick's impulses. */
  sampleAt(_position: Vec3): number {
    // TODO: implement per DESIGN.md — sum active emitters with distance falloff (MathHelpers.falloff)
    // plus any impulse still live this tick. Must be allocation-free; enemy brains call it per tick.
    throw new Error('NoiseSystem.sampleAt not implemented');
  }

  /** What a given listener perceives this tick, after threshold and sensitivity. */
  poll(_listenerId: string): readonly HeardNoise[] {
    // TODO: implement per DESIGN.md — sample per emitter, apply sensitivity, drop below threshold.
    throw new Error('NoiseSystem.poll not implemented');
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md
    //  1. accumulate from active emitters and this tick's impulses
    //  2. decay toward zero when the site is quiet — going quiet must actually help
    //  3. emit 'noise/thresholdCrossed' the first time each threshold is passed
    //  4. clear this tick's impulses
    // Thresholds and decay rate are unspecified; see docs/GAPS.md.
    throw new Error('NoiseSystem.update not implemented');
  }

  /** Between runs. Loudness is session state and never persists. */
  reset(): void {
    this.emitters.clear();
    this.listeners.clear();
    this.impulses.length = 0;
    this.accumulated = 0;
    this.crossedThresholds = new Set();
  }

  /** Exposed for the offline heatmap tool and the NoiseVisualizer. */
  get activeEmitters(): readonly NoiseEmitter[] {
    return [...this.emitters.values()].filter((emitter) => emitter.active);
  }

  get configuredThresholds(): readonly number[] {
    return this.thresholds;
  }

  get crossed(): ReadonlySet<number> {
    return this.crossedThresholds;
  }
}
