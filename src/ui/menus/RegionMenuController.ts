import type { ArchipelagoGraph } from '@campaign/ArchipelagoGraph';
import type { RegionId } from '@core/types/Vocabulary';
import { BaseMenuController } from '../MenuController';

/**
 * One region in detail: its sites, their connections, and where the front sits.
 *
 * The zoom level where the Warfront becomes legible. At world scale influence bleed is a smear; at
 * region scale the player can see which two sites are pressing on each other and work out why the
 * site between them has been getting harder.
 */
export class RegionMenuController extends BaseMenuController {
  readonly name = 'Region';

  constructor(
    private readonly graph: ArchipelagoGraph,
    private readonly regionId: RegionId,
  ) {
    super();
  }

  refresh(): void {
    // TODO: implement per DESIGN.md — sites, edges, per-site production and stockpile, contested
    // volumes, and the competence floor each site would start a run at.
    void this.graph;
    void this.regionId;
    throw new Error('RegionMenuController.refresh not implemented');
  }
}
