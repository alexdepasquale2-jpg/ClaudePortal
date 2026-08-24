/**
 * The Dread pillar, as a number on screen.
 *
 * "Should we turn on NNN?" is only a real question if the player can see what lighting it did. This
 * meter is the feedback half of that loop: it must show the current loudness, the RATE it is
 * climbing at, and how close the next Sancient threshold is.
 *
 * Rate matters more than level. A player who has just solidified a wall needs to see the spike and
 * watch it decay, or they will never learn that going quiet actually helps — and if they do not
 * learn that, the decision collapses into superstition.
 */
export class LoudnessMeter {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.root = document.createElement('div');
    this.root.className = 'hud-loudness';
    container.appendChild(this.root);
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
  }

  /** `nextThreshold` is null once every threshold has been crossed. */
  render(_loudness: number, _rate: number, _nextThreshold: number | null): void {
    // TODO: implement per DESIGN.md — level, direction of travel, and distance to the next
    // threshold. Mark the threshold explicitly: an unmarked bar is not a warning.
    void this.root;
    throw new Error('LoudnessMeter.render not implemented');
  }
}
