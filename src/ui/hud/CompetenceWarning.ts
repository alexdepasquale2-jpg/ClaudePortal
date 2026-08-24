/**
 * "It is aiming."
 *
 * ADR-0003 lists readability as a COST of the inverse-competence design: "A player must be able to
 * see that a floor has risen, or the reversal reads as a bug." This component is how that cost is
 * paid, and it is explicitly not optional polish.
 *
 * The moment to communicate is the WAIT. A competent Goliath turns, acquires, waits, and fires —
 * that pause is the player's entire window to react, and it only functions as a window if they
 * understand what they are looking at. A machine that has been harmless for five minutes going
 * quiet and still is the most important half-second in the game.
 */
export class CompetenceWarning {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.root = document.createElement('div');
    this.root.className = 'hud-competence-warning';
    container.appendChild(this.root);
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
  }

  /**
   * Called when a competence floor rises significantly
   * (LethalityCompetence.isSignificantChange).
   */
  warn(_affectedIds: readonly string[], _newFloor: number, _permanent: boolean): void {
    // TODO: implement per DESIGN.md — flag the specific machines, distinguish a temporary jack from
    // a permanent floor rise, and make it readable at a phone viewport without covering the pawn.
    void this.root;
    throw new Error('CompetenceWarning.warn not implemented');
  }

  clear(): void {
    // TODO: implement per DESIGN.md
  }
}
