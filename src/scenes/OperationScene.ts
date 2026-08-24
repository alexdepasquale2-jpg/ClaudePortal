import type { Scene } from '@core/bootstrap/SceneRouter';
import type { RunClock } from '@core/time/RunClock';
import type { SiteId } from '@core/types/Vocabulary';
import type { RenderContext } from '@render/RenderContext';
import type { RunResult } from '@campaign/RunResult';

/**
 * One operation. The only scene that is a live world.
 *
 * "One operation = one scene" lives here. Everything a run is — the pawn, the fort, the noise
 * field, the Goliaths, the Sancient that comes for them — exists inside this scene and is destroyed
 * with it.
 *
 * The most important line in this file is in `unload()`: the fort is torn down and NOT serialised.
 * ADR-0002. A fort exists only inside a play session. What crosses the boundary is a single
 * RunResult, handed to the campaign layer by the scene that owns both — this one.
 *
 * This is the composition root for a run: it builds every gameplay system, registers them with the
 * RunClock in a deliberate order, and takes them all down together.
 */
export class OperationScene implements Scene {
  readonly name = 'Operation';

  constructor(
    private readonly render: RenderContext,
    private readonly clock: RunClock,
    private readonly siteId: SiteId,
    private readonly runIndex: number,
    /** Called with the resolved run. The single crossing point from session to campaign. */
    private readonly onResolved: (result: RunResult) => Promise<void> | void,
  ) {}

  async load(): Promise<void> {
    // TODO: implement per DESIGN.md
    //  1. build a SeededGeneration from (campaignSeed, siteId, runIndex)
    //  2. generate the site, seeding its competence floor from the warfront — the last campaign's
    //     shape reaching into this run's opening minute
    //  3. instantiate pawn, camera rigs, input, fort, noise, enemies, Sancient director
    //  4. register systems with the clock in a deliberate order: input, then simulation, then noise
    //  5. carry in nodes the campaign says are already lit here: they start lit, producing and loud
    void this.render;
    void this.clock;
    void this.siteId;
    void this.runIndex;
    throw new Error('OperationScene.load not implemented');
  }

  /** Called by ExtractionSystem on any end type. All three write to the graph. */
  async resolve(result: RunResult): Promise<void> {
    await this.onResolved(result);
  }

  unload(): void {
    // TODO: implement per DESIGN.md — unregister every system, dispose site geometry, and tear the
    // fort down. The fort is DISCARDED here, never serialised: there is no code path from
    // FortRuntime to CampaignSave and there must never be one (ADR-0002).
    throw new Error('OperationScene.unload not implemented');
  }
}
