import type { InputFrame } from './InputSchemes';

/**
 * How a raw input frame is interpreted in the first-person manual view.
 *
 * Auto-fire is off entirely here — `firing` means the player pulled the trigger, and the shot goes
 * where the crosshair is. Pitch is clamped; movement is camera-relative; placement is the crosshair
 * ray's first hit.
 *
 * This view is unlocked last on purpose. It is more capable and much less forgiving, which is what
 * "views reach parity late via meta unlocks" is protecting against arriving too early.
 */
export interface FirstPersonIntent {
  readonly moveX: number;
  readonly moveZ: number;
  readonly yawDelta: number;
  readonly pitchDelta: number;
  /** Manual fire. Nothing else may pull the trigger in this view. */
  readonly firing: boolean;
  readonly placementPoint: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly buildMode: boolean;
}

/** Pitch clamp, in radians. Slightly short of vertical so the horizon never flips. */
export const MAX_PITCH = Math.PI / 2 - 0.01;

export function interpretFirstPerson(_frame: InputFrame, _currentPitch: number): FirstPersonIntent {
  // TODO: implement per DESIGN.md — accumulate and clamp pitch to +/- MAX_PITCH, movement in
  // camera space, placement from the crosshair ray.
  throw new Error('interpretFirstPerson not implemented');
}
