/**
 * The last decision of every run, presented.
 *
 * Leaving banks the haul and abandons the node. Staying keeps the node producing and risks
 * everything carried. This prompt gives the player the numbers that choice needs — carried value,
 * production at risk, current loudness, whether a Sancient is present, and whether the site flips if
 * they die here.
 *
 * It presents facts and never a recommendation. There is no auto-extract and no timer that forces
 * the choice: the game does not tell you when to leave. Greed only means something if the player is
 * the one being greedy.
 */
export class ExtractionPrompt {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.root = document.createElement('div');
    this.root.className = 'hud-extraction';
    container.appendChild(this.root);
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
  }

  /** Shown while the player is inside the zone. `holdProgress` is 0..1. */
  render(
    _holdProgress: number,
    _carriedValue: number,
    _productionAtRisk: number,
    _wouldFlipOnDeath: boolean,
  ): void {
    // TODO: implement per DESIGN.md — hold progress, what leaving banks, what leaving abandons.
    // Requires a deliberate hold on touch: a mis-tap must never end a run.
    void this.root;
    throw new Error('ExtractionPrompt.render not implemented');
  }

  hide(): void {
    // TODO: implement per DESIGN.md
  }
}
