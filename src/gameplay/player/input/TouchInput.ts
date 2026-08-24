import type { ViewMode } from '@core/types/Vocabulary';
import { emptyInputFrame, type InputFrame, type InputSource } from './InputSchemes';

/**
 * Phone and tablet input.
 *
 * A peer of KeyboardMouseInput, not a translation of it (ADR-0005). The differences are real:
 *
 *  - a virtual stick, not WASD, so movement is analogue and the deadzone matters
 *  - no hover, so there is no cursor to aim with — top-down aim is auto-fire only, which is
 *    precisely why top-down is the view that works one-handed
 *  - building is tap-to-place then confirm, because a mis-tap that solidifies a piece is expensive
 *    and there is no right mouse button to cancel with
 *
 * PointerEvents are used throughout so pen and mouse fall through this path too where a device
 * supports both.
 */
export class TouchInput implements InputSource {
  readonly id = 'touch';

  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private view: ViewMode = 'TopDown';

  attach(_element: HTMLElement): void {
    // TODO: implement per DESIGN.md — pointerdown/move/up/cancel with touch-action: none, plus a
    // virtual stick anchored where the first pointer landed rather than at a fixed screen position.
    throw new Error('TouchInput.attach not implemented');
  }

  detach(): void {
    this.activePointers.clear();
    // TODO: implement per DESIGN.md
  }

  configureFor(view: ViewMode): void {
    this.view = view;
    // TODO: implement per DESIGN.md — drag-to-look only in third/first person; in top-down the
    // second pointer is a build placement, not a camera gesture.
    void this.view;
  }

  poll(): InputFrame {
    // TODO: implement per DESIGN.md
    return emptyInputFrame();
  }
}
