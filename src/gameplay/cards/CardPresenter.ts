import type { InRunCard } from '@core/data/cards/InRunCard';

/**
 * The in-run card selection screen.
 *
 * Lives in gameplay rather than ui for the same reason as the other live overlays
 * (ARCHITECTURE.md): it is driven by run state and appears only inside an operation.
 *
 * It pauses the run clock while open. A Survivors-style card offer that ran on a live clock would
 * let a Sancient arrive while the player was reading, which turns a moment of Power into an ambush
 * — the wrong pillar at the wrong time.
 */
export class CardPresenter {
  private container: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.container = container;
  }

  unmount(): void {
    this.container?.replaceChildren();
    this.container = null;
  }

  /** Show a hand and resolve with the chosen card's id. */
  offer(_hand: readonly InRunCard[]): Promise<string> {
    // TODO: implement per DESIGN.md — render the hand, pause the clock, resolve on selection,
    // resume. Must be usable at a phone viewport with thumb-reachable targets.
    void this.container;
    throw new Error('CardPresenter.offer not implemented');
  }
}
