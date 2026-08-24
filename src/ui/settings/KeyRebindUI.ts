import type { InputAction } from '@core/types/InputActions';
import type { ViewMode } from '@core/types/Vocabulary';

/**
 * Rebinding.
 *
 * Bindings are PER VIEW, because camera and building are coupled: the same key means "place on the
 * grid" in top-down and "place along my look ray" in first person, and a player may reasonably want
 * those on different keys.
 *
 * A binding that would leave an action unreachable in a view the player has unlocked is refused.
 * Silently allowing it produces a run where the player cannot extract.
 */
export class KeyRebindUI {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.root = document.createElement('div');
    this.root.className = 'settings-rebind';
    container.appendChild(this.root);
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
  }

  render(_view: ViewMode, _bindings: ReadonlyMap<InputAction, string>): void {
    // TODO: implement per DESIGN.md — per-view binding list with conflict detection.
    void this.root;
    throw new Error('KeyRebindUI.render not implemented');
  }

  /** Refuses a rebind that would strand an action. */
  rebind(_view: ViewMode, _action: InputAction, _key: string): boolean {
    // TODO: implement per DESIGN.md
    throw new Error('KeyRebindUI.rebind not implemented');
  }
}
