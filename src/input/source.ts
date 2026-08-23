/** Both keyboard/mouse and touch produce this same intent object. Nothing downstream
 *  ever asks which device it came from — that is what makes mobile a data path, not a fork. */
export type Intent = {
  moveX: number;      // -1..1 strafe
  moveZ: number;      // -1..1 forward
  yawDelta: number;   // radians this frame
  pitchDelta: number;
  zoomDelta: number;
  jump: boolean;
};

export const emptyIntent = (): Intent => ({ moveX: 0, moveZ: 0, yawDelta: 0, pitchDelta: 0, zoomDelta: 0, jump: false });

export interface InputSource {
  /** Consume and return this frame's intent. */
  poll(): Intent;
  dispose(): void;
}

export function mergeIntents(a: Intent, b: Intent): Intent {
  return {
    moveX: clamp(a.moveX + b.moveX), moveZ: clamp(a.moveZ + b.moveZ),
    yawDelta: a.yawDelta + b.yawDelta, pitchDelta: a.pitchDelta + b.pitchDelta,
    zoomDelta: a.zoomDelta + b.zoomDelta, jump: a.jump || b.jump,
  };
}
const clamp = (v: number) => Math.max(-1, Math.min(1, v));
