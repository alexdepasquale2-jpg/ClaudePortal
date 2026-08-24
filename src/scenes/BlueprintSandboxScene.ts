import type { Scene } from '@core/bootstrap/SceneRouter';
import type { RenderContext } from '@render/RenderContext';

/**
 * Where blueprints are authored, between runs.
 *
 * A live 3D scene, but not an operation: no enemies, no noise consequences, no clock pressure,
 * nothing at stake. It exists so planning is a considered activity rather than something done under
 * fire.
 *
 * What it must show, and the reason it is worth having at all, is the plan's LOUDNESS CURVE — the
 * cumulative noise of executing the build order. That is what makes a blueprint a decision instead
 * of a convenience: two plans with identical pieces in a different order are genuinely different
 * bets, and this is where the player can see that before descending.
 */
export class BlueprintSandboxScene implements Scene {
  readonly name = 'BlueprintSandbox';

  constructor(
    private readonly render: RenderContext,
    private readonly overlay: HTMLElement,
  ) {}

  load(): void {
    // TODO: implement per DESIGN.md — flat build grid, full piece catalogue, free placement, and a
    // live readout of total cost and the build order's loudness curve.
    void this.render;
    void this.overlay;
    throw new Error('BlueprintSandboxScene.load not implemented');
  }

  unload(): void {
    this.overlay.replaceChildren();
  }
}
