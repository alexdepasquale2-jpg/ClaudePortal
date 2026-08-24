import type { CameraPreset } from '@core/data/tech/CameraPresets';
import type { CameraRig } from '@render/CameraRig';
import type { ViewMode } from '@core/types/Vocabulary';
import type { ViewBinding } from '../ViewSwitcher';

/**
 * The default view, and the game's spine.
 *
 * DESIGN.md: "Top-down (default, steep) — auto-fire Survivors spine." Steep is not a taste
 * decision — a shallow top-down becomes an isometric shooter, where the player aims. The steep
 * angle is what makes auto-fire read as correct rather than as the game playing itself.
 *
 * Building in this view places on a grid beneath the cursor, which is the most legible of the three
 * and the reason blueprints are authored against a grid at all.
 */
export class TopDownView implements ViewBinding {
  readonly mode: ViewMode = 'TopDown';

  constructor(private readonly rig: CameraRig) {}

  activate(preset: CameraPreset): void {
    this.rig.applyPreset(preset);
    // Facing follows movement here; the rig's yaw stays fixed so the map does not rotate under
    // the player. A rotating top-down map destroys spatial memory of where the extraction is.
    this.rig.setLook(0, 0);
  }

  deactivate(): void {
    // TODO: implement per DESIGN.md
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — follow the pawn with the preset's smoothing, and clamp the
    // camera so the extraction zone stays discoverable at the screen edge.
    throw new Error('TopDownView.update not implemented');
  }
}
