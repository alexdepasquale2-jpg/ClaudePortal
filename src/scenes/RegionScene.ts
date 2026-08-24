import type { Scene } from '@core/bootstrap/SceneRouter';
import type { RegionId } from '@core/types/Vocabulary';

/**
 * One region, zoomed in. Still a menu, still not a simulation.
 *
 * The zoom level where the Warfront becomes legible: at world scale influence bleed is a smear, at
 * region scale the player can see which two sites are pressing on each other and work out why the
 * one between them keeps getting harder.
 */
export class RegionScene implements Scene {
  readonly name = 'Region';

  constructor(
    private readonly overlay: HTMLElement,
    private readonly regionId: RegionId,
  ) {}

  load(): void {
    // TODO: implement per DESIGN.md — mount RegionMenuController for this region.
    void this.overlay;
    void this.regionId;
    throw new Error('RegionScene.load not implemented');
  }

  unload(): void {
    this.overlay.replaceChildren();
  }
}
