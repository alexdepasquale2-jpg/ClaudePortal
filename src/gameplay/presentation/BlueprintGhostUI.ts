import type { LiveBuildingSnapshot, LiveBuildingView } from '../building/LiveBuildingPresenter';

/**
 * Shows a loaded blueprint's progress in-run.
 *
 * Same placement reasoning as TowerDefenseOverlay: it reads live ghost state, so it belongs to
 * `gameplay`.
 *
 * What it shows matters to the design: how much of the plan is solidified, what it will cost to
 * finish, and how much noise finishing it will make. That last number is the one that turns a
 * blueprint from a convenience into a decision — the player can see the price of committing to the
 * rest of the plan before they pay it.
 */
export class BlueprintGhostUI implements LiveBuildingView {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.root = document.createElement('div');
    this.root.className = 'blueprint-ghost-ui';
    container.appendChild(this.root);
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
  }

  render(_snapshot: LiveBuildingSnapshot): void {
    // TODO: implement per DESIGN.md — completion fraction, remaining cost, and the remaining
    // loudness of the build order still to be executed.
    void this.root;
    throw new Error('BlueprintGhostUI.render not implemented');
  }
}
