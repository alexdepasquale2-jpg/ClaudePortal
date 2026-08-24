import type { MaterialCounts } from '@core/types/Vocabulary';
import type { SavedSite } from '@campaign/CampaignSave';
import { BaseMenuController } from '../MenuController';

/**
 * What the campaign holds, and where.
 *
 * Two numbers that must not be conflated: the global stockpile, and per-site stockpiles that are
 * only yours while you hold the site. A player about to lose a site should be able to see exactly
 * what is sitting on it, because that material changes hands with it
 * (ProductionInheritance) — losing a site is not only losing a position.
 *
 * Pyron Chrome is listed separately from the other three tiers. It is found, never forged, so a
 * count of it is a statement about the whole campaign rather than a resource bar.
 */
export class ResourcesMenuController extends BaseMenuController {
  readonly name = 'Resources';

  constructor(
    private readonly globalStockpile: MaterialCounts,
    private readonly sites: readonly SavedSite[],
  ) {
    super();
  }

  refresh(): void {
    // TODO: implement per DESIGN.md — global stockpile, per-site holdings and production rates,
    // and a clear marker on material that is at risk because its site is contested.
    void this.globalStockpile;
    void this.sites;
    throw new Error('ResourcesMenuController.refresh not implemented');
  }
}
