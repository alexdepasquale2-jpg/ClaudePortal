import type { EventBus } from '@core/events/EventBus';
import type { CameraPreset } from '@core/data/tech/CameraPresets';
import { DEFAULT_VIEW_MODE, type ViewMode } from '@core/types/Vocabulary';

/**
 * Switches between the three views, live, mid-run.
 *
 * DESIGN.md: "Camera and building are coupled." Changing the view changes the camera rig AND the
 * input scheme AND how building works — top-down places on a grid under the cursor, first-person
 * places where you are looking. Those three cannot be switched independently or they drift out of
 * agreement, which is why one class owns all three.
 *
 * "Views reach parity late via meta unlocks": the presets available per view depend on unlocked
 * tech, so early on the other two views are genuinely worse. That is intended, not a gap.
 */
export interface ViewBinding {
  readonly mode: ViewMode;
  activate(preset: CameraPreset): void;
  deactivate(): void;
  update(dt: number): void;
}

export class ViewSwitcher {
  private readonly bindings = new Map<ViewMode, ViewBinding>();
  private current: ViewMode = DEFAULT_VIEW_MODE;

  constructor(private readonly events: EventBus) {}

  get activeView(): ViewMode {
    return this.current;
  }

  register(binding: ViewBinding): void {
    this.bindings.set(binding.mode, binding);
  }

  /** Switch views. Must not move the pawn — only the camera and the input scheme change. */
  switchTo(_mode: ViewMode, _preset: CameraPreset): void {
    // TODO: implement per DESIGN.md — deactivate the current binding, activate the next, swap the
    // input scheme to match, and emit 'view/changed'. The pawn is untouched.
    void this.events;
    throw new Error('ViewSwitcher.switchTo not implemented');
  }

  /** Views the player has unlocked presets for. Early campaigns have exactly one. */
  availableViews(_unlockedPresets: readonly string[]): readonly ViewMode[] {
    // TODO: implement per DESIGN.md
    throw new Error('ViewSwitcher.availableViews not implemented');
  }

  update(dt: number): void {
    this.bindings.get(this.current)?.update(dt);
  }
}
