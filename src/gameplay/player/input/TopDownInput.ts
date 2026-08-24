import type { InputFrame } from './InputSchemes';

/**
 * How a raw input frame is interpreted in the top-down view.
 *
 * Movement is world-relative (the map does not rotate — see TopDownView), aim is ignored because
 * auto-fire owns targeting, and the build placement point is the cursor projected onto the ground
 * plane. On touch there is no cursor, so placement is the tap point.
 *
 * This is the "camera and building are coupled" rule as a translation layer: same InputFrame,
 * different meaning per view.
 */
export interface TopDownIntent {
  readonly moveX: number;
  readonly moveZ: number;
  /** Ground-plane point to place a ghost at, or null when not building. */
  readonly placementPoint: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly buildMode: boolean;
}

export function interpretTopDown(_frame: InputFrame): TopDownIntent {
  // TODO: implement per DESIGN.md — world-relative movement, snap placementPoint to the build grid.
  throw new Error('interpretTopDown not implemented');
}
