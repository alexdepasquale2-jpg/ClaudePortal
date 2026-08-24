import type { CameraPreset } from '@core/data/tech/CameraPresets';
import type { CameraRig } from '@render/CameraRig';
import type { ViewMode } from '@core/types/Vocabulary';
import type { ViewBinding } from '../ViewSwitcher';

/**
 * The hybrid view.
 *
 * DESIGN.md: "Third-person — hybrid." Auto-fire still runs, but the player's look direction biases
 * target selection, so it sits between the top-down spine and first-person's full manual control.
 *
 * Building here places along the look ray at a fixed distance — closer to first-person's feel than
 * to top-down's grid, which is the coupling the design calls for.
 */
export class ThirdPersonView implements ViewBinding {
  readonly mode: ViewMode = 'ThirdPerson';

  constructor(private readonly rig: CameraRig) {}

  activate(preset: CameraPreset): void {
    this.rig.applyPreset(preset);
  }

  deactivate(): void {
    // TODO: implement per DESIGN.md
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — follow with an orbit offset, and collide the camera against
    // fort geometry so a solidified wall does not put the camera inside it.
    throw new Error('ThirdPersonView.update not implemented');
  }
}
