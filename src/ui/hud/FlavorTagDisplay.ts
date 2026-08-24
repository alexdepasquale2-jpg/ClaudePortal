import type { FlavorTag } from '@core/types/Vocabulary';

/**
 * The current flavor tag, and what it is doing.
 *
 * DESIGN.md: "Labels without consequences are forbidden." This display is where that rule becomes
 * visible to the player — it must show the tag AND its mechanical consequence, together. A tag
 * rendered as a bare word would be exactly the forbidden thing, whatever the code behind it does.
 *
 * Exactly one tag is ever active. The runner-up may be shown as context ("Logistics is close"), but
 * never as a second active label.
 */
export class FlavorTagDisplay {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.root = document.createElement('div');
    this.root.className = 'hud-flavor-tag';
    container.appendChild(this.root);
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
  }

  /** `consequence` is required, not optional. A tag with nothing to say does not render. */
  render(_tag: FlavorTag | null, _consequence: string): void {
    // TODO: implement per DESIGN.md — the tag and its locked consequence in one element. The five
    // consequences are not yet chosen (docs/GAPS.md), which is why this cannot ship yet either.
    void this.root;
    throw new Error('FlavorTagDisplay.render not implemented');
  }
}
