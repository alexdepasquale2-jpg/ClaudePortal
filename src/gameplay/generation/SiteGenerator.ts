import type { QualityTier } from '@core/data/settings/QualityTiers';
import type { Vec3 } from '@core/types/Vocabulary';
import type { SeededGeneration } from './SeededGeneration';

/**
 * Builds one operation's site.
 *
 * Sites are GENERATED, never stored (see Site.ts). That is what keeps the campaign save small no
 * matter how large the archipelago grows, and it is only possible because generation is fully
 * deterministic from (campaignSeed, siteId, runIndex).
 *
 * Two inputs make a site different from run to run at the same location:
 *
 *  - `runIndex`, so returning somewhere is not identical
 *  - the site's persisted state — lit nodes left behind, the permanent competence floor,
 *    who holds it — which is the campaign graph reaching into this run's opening minute
 *
 * The quality tier is an input rather than a post-process: a phone gets a site built with fewer
 * spawn points, not a full site culled afterwards (ADR-0005).
 */
export interface SiteLayout {
  readonly extractionPosition: Vec3;
  readonly playerSpawn: Vec3;
  readonly materialScatter: readonly {
    readonly position: Vec3;
    readonly tier: string;
    readonly amount: number;
  }[];
  readonly goliathSpawns: readonly { readonly position: Vec3; readonly catalogId: string }[];
  readonly nobotSpawns: readonly { readonly position: Vec3; readonly groupId: string }[];
  readonly nodeSockets: readonly { readonly position: Vec3; readonly primary: boolean }[];
  /** Nodes the campaign says are already lit here. They start lit, producing, and loud. */
  readonly preLitNodes: readonly { readonly position: Vec3; readonly nodeId: string }[];
  /** Where a usable Pyron Chrome mass is, if this site has one. */
  readonly pyronChromePosition: Vec3 | null;
  /** Starting competence floor, from the warfront and this site's permanent floor. */
  readonly baseCompetenceFloor: number;
}

export class SiteGenerator {
  constructor(
    private readonly generation: SeededGeneration,
    private readonly quality: QualityTier,
  ) {}

  /** Generate the layout. Deterministic: same inputs, same site, every time. */
  generate(_biomeId: string, _persistedState: unknown): SiteLayout {
    // TODO: implement per DESIGN.md
    //  - place extraction first; everything else is positioned relative to it, because
    //    greedDistance only means something measured from the way out
    //  - respect quality.maxSimultaneousEnemies when placing spawns, not afterwards
    //  - carry persisted lit nodes in as pre-lit: the last run's decision is this run's opening
    //  - seed the base competence floor from the warfront calculation, not from zero
    void this.generation;
    void this.quality;
    throw new Error('SiteGenerator.generate not implemented');
  }
}
