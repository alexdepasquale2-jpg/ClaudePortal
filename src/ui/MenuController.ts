/**
 * Shared shape for every campaign menu.
 *
 * DESIGN.md: "Vampire Survivors-style menu layer with region and territory information." These are
 * DOM menus over campaign data, not scenes with physics — which is what lets the World menu show a
 * hundred sites without any of them being simulated.
 *
 * Every controller in this layer can only reach `core`, `campaign` and `render`. It cannot import
 * `gameplay`, so no menu can touch a live run. That is enforced by lint, not by convention
 * (ARCHITECTURE.md).
 */
export interface MenuController {
  readonly name: string;
  mount(container: HTMLElement): void;
  unmount(): void;
  /** Redraw from current campaign state. Menus are pull-based; there is no live loop here. */
  refresh(): void;
}

/** Common mount/unmount plumbing, so each controller only writes the part that differs. */
export abstract class BaseMenuController implements MenuController {
  abstract readonly name: string;
  protected root: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.root = document.createElement('section');
    this.root.className = `menu menu--${this.name.toLowerCase()}`;
    container.appendChild(this.root);
    this.refresh();
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
  }

  abstract refresh(): void;
}
