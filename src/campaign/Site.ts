import type { RegionId, SiteId, Vec2 } from '@core/types/Vocabulary';
import type { Ownership } from './Ownership';
import type { SiteState } from './SiteState';

/**
 * One node of the archipelago.
 *
 * A site is an entry in a graph, not a loaded world. DESIGN.md: "Never load the entire archipelago
 * as one physics scene. One operation = one scene." The World and Region menus render hundreds of
 * these; only OperationScene ever turns one into geometry, and it does so by generating from
 * `(campaignSeed, id)` rather than by loading stored terrain.
 *
 * That is why there is no layout field here. Sites are regenerated, not stored — which keeps the
 * save small no matter how large the archipelago becomes.
 */
export interface Site {
  readonly id: SiteId;
  readonly regionId: RegionId;
  readonly displayName: string;
  /** Position on the region map, for influence and adjacency. Not a world position. */
  readonly position: Vec2;
  /** Sites reachable from here. Edges are undirected; both ends list each other. */
  readonly neighbours: readonly SiteId[];
  readonly ownership: Ownership;
  readonly state: SiteState;
}

export interface Region {
  readonly id: RegionId;
  readonly displayName: string;
  readonly siteIds: readonly SiteId[];
}

/** A site is worth descending into if it produces, or if somebody else thinks it is. */
export const isLit = (site: Site): boolean => site.state.litNodes.length > 0;
