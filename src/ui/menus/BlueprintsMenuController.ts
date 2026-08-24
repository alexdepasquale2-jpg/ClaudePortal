import type { BlueprintAsset } from '@core/data/blueprints/BlueprintAsset';
import { BaseMenuController } from '../MenuController';

/**
 * Planning forts between runs.
 *
 * Blueprints persist and forts do not, which looks inconsistent until you notice a blueprint carries
 * no state from any run (ADR-0002). It is an intention, not a structure. Loading one costs full
 * price every time.
 *
 * The number this screen must show, and the one that makes blueprints a design decision rather than
 * a convenience, is the plan's LOUDNESS — how much noise executing it will make, and in what order.
 * A plan that walls the node before making any noise is a different bet from one that throws up
 * turrets first, and the player should be able to see that before descending.
 */
export class BlueprintsMenuController extends BaseMenuController {
  readonly name = 'Blueprints';

  constructor(private readonly blueprints: readonly BlueprintAsset[]) {
    super();
  }

  refresh(): void {
    // TODO: implement per DESIGN.md — list plans with total cost and estimated loudness, and open
    // the sandbox scene for editing. Editing happens in BlueprintSandbox, not here.
    void this.blueprints;
    throw new Error('BlueprintsMenuController.refresh not implemented');
  }
}
