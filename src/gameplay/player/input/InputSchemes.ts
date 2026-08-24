import type { InputAction } from '@core/types/InputActions';
import type { ViewMode } from '@core/types/Vocabulary';

/**
 * What the game asks of an input device, independent of what the device is.
 *
 * Two adapters implement this: KeyboardMouseInput and TouchInput. Mobile is a target rather than a
 * fallback (ADR-0005), so touch is not a translation layer over mouse events — it is a peer
 * implementation with its own idea of what "aim" means.
 *
 * ViewSwitcher picks the scheme per view, because camera and building are coupled: the same physical
 * gesture means "place on the grid" in top-down and "place along my look ray" in first person.
 */
export interface InputFrame {
  /** Movement intent, -1..1 per axis, already deadzoned and normalised. */
  readonly moveX: number;
  readonly moveZ: number;
  /** Look delta this frame, in radians. Zero in top-down. */
  readonly lookYawDelta: number;
  readonly lookPitchDelta: number;
  /** World-space aim point, when the scheme can produce one (cursor, tap, crosshair ray). */
  readonly aimPoint: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly firing: boolean;
  readonly buildModeHeld: boolean;
  /** Edge-triggered actions consumed once per frame. */
  readonly actions: ReadonlySet<InputAction>;
}

/** Re-exported from core so the Settings menu can render a rebinding list without importing gameplay. */
export type { InputAction };

export interface InputSource {
  readonly id: string;
  /** Attach listeners. Called when the scheme becomes active. */
  attach(element: HTMLElement): void;
  detach(): void;
  /** Configure for the active view — pointer lock in first person, virtual stick in top-down. */
  configureFor(view: ViewMode): void;
  /** Read and clear this frame's state. Called once per tick. */
  poll(): InputFrame;
}

export const emptyInputFrame = (): InputFrame => ({
  moveX: 0,
  moveZ: 0,
  lookYawDelta: 0,
  lookPitchDelta: 0,
  aimPoint: null,
  firing: false,
  buildModeHeld: false,
  actions: new Set(),
});
