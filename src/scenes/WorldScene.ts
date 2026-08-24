import type { Scene } from '@core/bootstrap/SceneRouter';
import type { ArchipelagoGraph } from '@campaign/ArchipelagoGraph';

/**
 * The archipelago, as a menu.
 *
 * DESIGN.md is explicit and this scene is where it is honoured: "Never load the entire archipelago
 * as one physics scene. One operation = one scene."
 *
 * So this renders a MAP. No pawn, no physics, no enemies, no simulation — a DOM/canvas drawing of
 * campaign data with influence bleed on top. It can show a hundred sites because none of them
 * exist as anything more than graph entries.
 *
 * This is also the screen the vertical slice's definition of done is stated against: close the tab,
 * reopen it, and a site you lost is still lost (SCOPE-LEDGER.md).
 */
export class WorldScene implements Scene {
  readonly name = 'World';

  constructor(
    private readonly overlay: HTMLElement,
    private readonly graph: ArchipelagoGraph,
  ) {}

  load(): void {
    // TODO: implement per DESIGN.md — mount WorldMenuController, wire site selection to
    // SceneRouter.goto('Operation'). Nothing here starts a physics simulation.
    void this.overlay;
    void this.graph;
    throw new Error('WorldScene.load not implemented');
  }

  unload(): void {
    this.overlay.replaceChildren();
  }
}
