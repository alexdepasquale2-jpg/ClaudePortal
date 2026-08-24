import type { CameraPreset } from '@core/data/tech/CameraPresets';
import type { CameraRig } from '@render/CameraRig';
import type { ViewMode } from '@core/types/Vocabulary';
import type { ViewBinding } from '../ViewSwitcher';

/**
 * The manual view.
 *
 * DESIGN.md: "First-person — manual." Auto-fire is off; the player aims. This is the view where a
 * jacked Goliath is most frightening and least survivable, because you can only look at one of them
 * at a time.
 *
 * It is also the view that arrives last (the `eyes-down` tech node), which is what "views reach
 * parity late via meta unlocks" means in practice.
 */
export class FirstPersonView implements ViewBinding {
  readonly mode: ViewMode = 'FirstPerson';

  constructor(private readonly rig: CameraRig) {}

  activate(preset: CameraPreset): void {
    this.rig.applyPreset(preset);
  }

  deactivate(): void {
    // TODO: implement per DESIGN.md — release pointer lock if held.
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — camera sits at the pawn's eye height with no smoothing;
    // any smoothing here reads as input lag rather than as weight.
    throw new Error('FirstPersonView.update not implemented');
  }
}
