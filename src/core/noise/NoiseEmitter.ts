import type { Vec3 } from '../types/Vocabulary';

/**
 * Something that makes noise.
 *
 * DESIGN.md: "Building is loud. Loudness brings the Sancients." Every action with a noise cost
 * registers an emitter — solidifying a piece, lighting an NNN, a running refinery, weapons fire.
 *
 * Pyron Chrome installed on a primary NNN reduces that node's noise signature; it is expressed here
 * as a multiplier on `loudness`, not as a special case elsewhere, so there is exactly one place
 * where protection changes the maths.
 */
export interface NoiseEmitter {
  readonly id: string;
  /** Where the noise originates, in site space. */
  readonly position: Vec3;
  /** Base loudness before any attenuation or shielding. Unspecified units — see docs/GAPS.md. */
  readonly loudness: number;
  /** How far it carries. Beyond this radius the emitter contributes nothing. */
  readonly radius: number;
  /** Human-readable source, for the HUD and the noise heatmap tool. */
  readonly source: string;
  /** False while the emitter exists but is silent (an unlit node, an idle refinery). */
  readonly active: boolean;
}

/** A one-off noise event rather than a continuous source: a shot, an impact, a wall going up. */
export interface NoiseImpulse {
  readonly position: Vec3;
  readonly loudness: number;
  readonly radius: number;
  readonly source: string;
}

export function createEmitter(init: NoiseEmitter): NoiseEmitter {
  return init;
}
