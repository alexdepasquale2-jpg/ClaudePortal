import type { CampaignStep } from '@core/time/TimeAdvancer';
import type { MaterialCounts, SiteId } from '@core/types/Vocabulary';

/**
 * Production at campaign scale, between runs.
 *
 * A lit node left behind keeps producing while you are not there. That is one of the clearest
 * expressions of the core concept — the battlefield changes whether or not you are standing on it,
 * and a node you lit last run is filling somebody's stockpile right now. Possibly not yours.
 *
 * Runs before PipelineNetwork in the TimeAdvancer order, so material produced this step can move
 * this step.
 */
export interface SiteProduction {
  readonly siteId: SiteId;
  /** Per campaign tick, derived from lit nodes and running refineries at the site. */
  readonly perTick: MaterialCounts;
}

export class ProductionTick {
  private readonly sites = new Map<SiteId, SiteProduction>();

  upsert(production: SiteProduction): void {
    this.sites.set(production.siteId, production);
  }

  get all(): readonly SiteProduction[] {
    return [...this.sites.values()];
  }

  /** What each site produces over one campaign step. */
  produce(_step: CampaignStep): ReadonlyMap<SiteId, MaterialCounts> {
    // TODO: implement per DESIGN.md — perTick * step.elapsedTicks, per site.
    throw new Error('ProductionTick.produce not implemented');
  }
}
