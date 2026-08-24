import type { MaterialTier, SiteId } from '@core/types/Vocabulary';

/**
 * A standing material route between two sites the player holds.
 *
 * Pipelines are the Logistics menu's whole content and the reason holding a cluster of sites is
 * worth more than holding the same number scattered. They move production to where it can be spent
 * — a site that produces plate and a site that can spend it are worth nothing to each other
 * unconnected.
 *
 * A pipeline is campaign infrastructure, not fort infrastructure: it survives runs, because it is
 * not built inside one.
 */
export interface Pipeline {
  readonly id: string;
  readonly from: SiteId;
  readonly to: SiteId;
  /** Which tiers this route carries. */
  readonly carries: readonly MaterialTier[];
  /** Units per campaign tick. */
  readonly throughput: number;
  /**
   * How exposed the route is, 0..1. A pipeline crossing a contested volume can be cut — which is
   * how the Warfront reaches the Logistics menu without either knowing about the other.
   */
  readonly exposure: number;
  /** False while cut. A cut pipeline is not deleted; it is a problem you can go and solve. */
  readonly active: boolean;
}
