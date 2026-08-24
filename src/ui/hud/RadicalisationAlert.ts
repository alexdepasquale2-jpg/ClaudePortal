/**
 * "They are counting."
 *
 * ADR-0004's stated cost: an invisible accumulating number must be made legible BEFORE it fires.
 * A betrayal the player did not see coming reads as arbitrary rather than as consequence, and
 * consequence is the pillar that wins ties.
 *
 * So this alert fires on the approach, not on the event. By the time a group actually turns, the
 * player should have already been told twice.
 */
export class RadicalisationAlert {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.root = document.createElement('div');
    this.root.className = 'hud-radicalisation';
    container.appendChild(this.root);
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
  }

  /** Warn as a group nears its threshold. Fired repeatedly on the approach, not once at the end. */
  render(_groupName: string, _radicalisation: number, _threshold: number): void {
    // TODO: implement per DESIGN.md — show the distance to betrayal, and escalate as it closes.
    void this.root;
    throw new Error('RadicalisationAlert.render not implemented');
  }

  /** The turn itself. By now this should confirm something, not reveal it. */
  announceBetrayal(_groupName: string): void {
    // TODO: implement per DESIGN.md
    throw new Error('RadicalisationAlert.announceBetrayal not implemented');
  }
}
