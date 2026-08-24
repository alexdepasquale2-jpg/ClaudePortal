import type { LiveBuildingSnapshot, LiveBuildingView } from '../building/LiveBuildingPresenter';

/**
 * The in-run building HUD.
 *
 * ARCHITECTURE.md, deliberate placement #1: this lives in `gameplay`, not `ui`, because it reads
 * live fort state. Putting it in `ui` would have forced `ui -> gameplay` and destroyed the boundary
 * that keeps forts session-only (ADR-0002).
 *
 * It receives a plain LiveBuildingSnapshot rather than the FortRuntime itself — the snapshot is the
 * boundary, and nothing beyond LiveBuildingPresenter ever holds a live fort reference.
 *
 * DESIGN.md: "Forts and Tower Defense builds are live/session-only." This overlay does not exist
 * outside an operation, and there is no campaign-side counterpart.
 */
export class TowerDefenseOverlay implements LiveBuildingView {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.root = document.createElement('div');
    this.root.className = 'td-overlay';
    container.appendChild(this.root);
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
  }

  render(_snapshot: LiveBuildingSnapshot): void {
    // TODO: implement per DESIGN.md — piece counts, what is currently solidifying, and the loudness
    // that solidifying is generating. The loudness readout is not decoration: it is how the player
    // sees the Power pillar spending the Dread pillar.
    void this.root;
    throw new Error('TowerDefenseOverlay.render not implemented');
  }
}
