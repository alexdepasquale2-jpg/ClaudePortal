import type { RegionId, SiteId } from '@core/types/Vocabulary';
import type { Region, Site } from './Site';

/**
 * The permanent record.
 *
 * ADR-0001: "the permanent record is the shape of the campaign graph the player has created through
 * repeated failure and opportunistic success." This class holds that shape. It is the only thing in
 * the game that persists, and everything else is either derived from it or session-only.
 *
 * It is deliberately inert — a data structure with queries, no simulation. It cannot import
 * gameplay, so it can be fully rendered by the World and Region menus with no run machinery in
 * existence. That constraint is enforced by the layer graph, not by discipline.
 */
export class ArchipelagoGraph {
  private readonly sites = new Map<SiteId, Site>();
  private readonly regions = new Map<RegionId, Region>();

  constructor(readonly campaignSeed: number) {}

  get siteCount(): number {
    return this.sites.size;
  }

  get allSites(): readonly Site[] {
    return [...this.sites.values()];
  }

  get allRegions(): readonly Region[] {
    return [...this.regions.values()];
  }

  site(id: SiteId): Site {
    const found = this.sites.get(id);
    if (!found) throw new Error(`No site "${id}" in the archipelago`);
    return found;
  }

  trySite(id: SiteId): Site | undefined {
    return this.sites.get(id);
  }

  region(id: RegionId): Region {
    const found = this.regions.get(id);
    if (!found) throw new Error(`No region "${id}" in the archipelago`);
    return found;
  }

  sitesInRegion(id: RegionId): readonly Site[] {
    return this.region(id).siteIds.map((siteId) => this.site(siteId));
  }

  neighboursOf(id: SiteId): readonly Site[] {
    return this.site(id).neighbours.map((neighbourId) => this.site(neighbourId));
  }

  /** Replace a site wholesale. The only mutation path — every change is a whole new Site value. */
  upsertSite(site: Site): void {
    this.sites.set(site.id, site);
  }

  upsertRegion(region: Region): void {
    this.regions.set(region.id, region);
  }

  /**
   * Sites the player can reach from where they currently hold ground.
   * The archipelago is not an open menu — reach is itself a consequence of the graph's shape.
   */
  reachableFrom(_id: SiteId, _maxHops: number): readonly Site[] {
    // TODO: implement per DESIGN.md — breadth-first over neighbours, stopping at maxHops.
    throw new Error('ArchipelagoGraph.reachableFrom not implemented');
  }

  /** Generate a fresh archipelago from the campaign seed. */
  static generate(_campaignSeed: number, _regionCount: number): ArchipelagoGraph {
    // TODO: implement per DESIGN.md — deterministic from the seed alone; the same seed must always
    // produce the same archipelago, or a shared campaign seed means nothing.
    throw new Error('ArchipelagoGraph.generate not implemented');
  }
}
