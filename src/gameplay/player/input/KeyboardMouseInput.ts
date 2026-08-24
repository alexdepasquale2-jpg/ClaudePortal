import type { ViewMode } from '@core/types/Vocabulary';
import { emptyInputFrame, type InputFrame, type InputSource } from './InputSchemes';

/**
 * Desktop input.
 *
 * Per-view behaviour differs because camera and building are coupled:
 *  - top-down: WASD moves, the cursor is the aim point and the build placement point, no look
 *  - third person: WASD moves relative to the camera, mouse orbits, look biases auto-fire targeting
 *  - first person: pointer lock, mouse is aim, auto-fire is off
 *
 * Bindings are rebindable through KeyRebindUI; the defaults live here.
 */
export class KeyboardMouseInput implements InputSource {
  readonly id = 'keyboard-mouse';

  private readonly held = new Set<string>();
  private view: ViewMode = 'TopDown';

  attach(_element: HTMLElement): void {
    // TODO: implement per DESIGN.md — keydown/keyup, pointermove, pointerdown/up, wheel.
    throw new Error('KeyboardMouseInput.attach not implemented');
  }

  detach(): void {
    this.held.clear();
    // TODO: implement per DESIGN.md — remove listeners, exit pointer lock.
  }

  configureFor(view: ViewMode): void {
    this.view = view;
    // TODO: implement per DESIGN.md — request pointer lock in FirstPerson, release it otherwise.
    void this.view;
  }

  poll(): InputFrame {
    // TODO: implement per DESIGN.md — build a frame from held keys and accumulated pointer deltas,
    // then clear the edge-triggered actions.
    return emptyInputFrame();
  }
}
