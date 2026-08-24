import type { Vec3 } from '../types/Vocabulary';

/**
 * Something that can hear.
 *
 * Goliaths hear. The Sancient director hears, at site scale, and it is that listener which turns
 * loudness into an arrival — the causal chain the Dread pillar rests on:
 *
 *   build loudly -> loudness accumulates -> a Sancient comes -> Goliaths become competent.
 *
 * Hearing is deliberately separate from the emitter side so the same field can be sampled by an
 * enemy brain, by the HUD's LoudnessMeter, and by the offline noise heatmap tool without any of
 * them knowing about each other.
 */
export interface HearingComponent {
  readonly id: string;
  readonly position: Vec3;
  /** Loudness below this is not perceived at all. */
  readonly threshold: number;
  /** Multiplier on perceived loudness. A jacked Goliath hears better because it is paying attention. */
  readonly sensitivity: number;
}

export interface HeardNoise {
  readonly source: string;
  readonly position: Vec3;
  /** Loudness as perceived at the listener, after distance falloff and sensitivity. */
  readonly perceived: number;
}
