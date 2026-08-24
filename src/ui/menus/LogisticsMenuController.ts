import type { Pipeline } from '@campaign/Pipeline';
import type { SavedSite } from '@campaign/CampaignSave';
import { BaseMenuController } from '../MenuController';

/**
 * Pipelines: what is connected to what, and what has been cut.
 *
 * A pipeline crossing a contested volume can be cut, which is how the Warfront reaches logistics
 * without either system knowing about the other. A cut route is not deleted — it stays on this
 * screen as a problem the player can go and solve, which is how a logistics failure becomes a
 * reason to descend somewhere specific.
 *
 * This is also where the value of a cluster becomes visible: holding four adjacent sites is worth
 * more than four scattered ones, and the player should be able to see why.
 */
export class LogisticsMenuController extends BaseMenuController {
  readonly name = 'Logistics';

  constructor(
    private readonly pipelines: readonly Pipeline[],
    private readonly sites: readonly SavedSite[],
  ) {
    super();
  }

  refresh(): void {
    // TODO: implement per DESIGN.md — routes with throughput and exposure, cut routes flagged
    // prominently, stalled output queues, and the option to plan a new route between held sites.
    void this.pipelines;
    void this.sites;
    throw new Error('LogisticsMenuController.refresh not implemented');
  }
}
