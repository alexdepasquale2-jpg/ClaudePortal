import type { FortRuntime } from './FortRuntime';

/**
 * The DOM bridge for in-run building UI.
 *
 * ARCHITECTURE.md, deliberate placement #1: TowerDefenseOverlay and BlueprintGhostUI live under
 * `gameplay`, not `ui`, because they read live fort state. Putting them in `ui` would have forced
 * `ui -> gameplay` and destroyed the boundary that keeps forts session-only (ADR-0002).
 *
 * This class is the seam that makes that placement work: the live overlays talk to the fort through
 * here, and nothing in `ui` ever sees a FortRuntime.
 */
export interface LiveBuildingView {
  mount(container: HTMLElement): void;
  unmount(): void;
  render(snapshot: LiveBuildingSnapshot): void;
}

/** A read-only projection of fort state. Plain data — no live references escape the fort. */
export interface LiveBuildingSnapshot {
  readonly pieceCount: number;
  readonly solidifiedCount: number;
  readonly solidifyingCount: number;
  readonly blueprintCompletion: number | null;
  readonly loudness: number;
}

export class LiveBuildingPresenter {
  private readonly views: LiveBuildingView[] = [];

  constructor(private readonly fort: FortRuntime) {}

  attach(view: LiveBuildingView, container: HTMLElement): void {
    view.mount(container);
    this.views.push(view);
  }

  detachAll(): void {
    for (const view of this.views) view.unmount();
    this.views.length = 0;
  }

  /** Project fort state into plain data and push it to every attached view. */
  refresh(): void {
    // TODO: implement per DESIGN.md — build a LiveBuildingSnapshot and render each view. Must not
    // hand out the FortRuntime itself; the snapshot is the boundary.
    void this.fort;
    throw new Error('LiveBuildingPresenter.refresh not implemented');
  }
}
