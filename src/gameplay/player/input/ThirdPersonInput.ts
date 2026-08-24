import type { InputFrame } from './InputSchemes';

/**
 * How a raw input frame is interpreted in the third-person hybrid view.
 *
 * Movement becomes camera-relative, look accumulates into a yaw the camera orbits by, and the look
 * direction biases auto-fire target selection rather than replacing it — that bias is what makes
 * this view "hybrid" rather than a worse first-person.
 *
 * Placement is along the look ray at a fixed distance, not on a screen-space grid.
 */
export interface ThirdPersonIntent {
  readonly moveX: number;
  readonly moveZ: number;
  readonly yawDelta: number;
  readonly pitchDelta: number;
  /** Normalised direction auto-fire should prefer when choosing among valid targets. */
  readonly targetingBias: { readonly x: number; readonly z: number };
  readonly placementPoint: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly buildMode: boolean;
}

export function interpretThirdPerson(_frame: InputFrame, _cameraYaw: number): ThirdPersonIntent {
  // TODO: implement per DESIGN.md — rotate movement into camera space, derive targetingBias from
  // the look direction, raycast placement along the look ray.
  throw new Error('interpretThirdPerson not implemented');
}
