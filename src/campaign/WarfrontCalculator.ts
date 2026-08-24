import type { InfluenceVolumeSettings } from '@core/data/campaign/InfluenceVolumeSettings';
import type { Faction, SiteId, Vec2 } from '@core/types/Vocabulary';
import type { InfluenceVolume, TerritoryInfluence } from './TerritoryInfluence';

/**
 * Finds where influence volumes overlap, and what that does.
 *
 * DESIGN.md: "Competence floors rise inside overlapping volumes. Visualised on the World/Region
 * menus as influence bleed."
 *
 * There is no Warfront mode, no Warfront scene and no Warfront entity. There is only this
 * calculation. A player who describes "the front" is describing the output of this class, which is
 * the design working as intended: the war is emergent from where people have been lighting nodes.
 *
 * The competence floor it produces is read by a run BEFORE the run starts — which is how the last
 * campaign's shape reaches into this run's opening minute.
 */
export interface ContestedRegion {
  readonly centre: Vec2;
  readonly radius: number;
  /** Every faction with meaningful influence here, strongest first. */
  readonly factions: readonly { readonly faction: Faction; readonly strength: number }[];
  /** Combined competence floor inside this region, 0..1. */
  readonly competenceFloor: number;
}

export class WarfrontCalculator {
  constructor(
    private readonly influence: TerritoryInfluence,
    private readonly settings: InfluenceVolumeSettings,
  ) {}

  /** Every region where two or more DIFFERENT factions overlap past the contest threshold. */
  contestedRegions(_volumes: readonly InfluenceVolume[]): readonly ContestedRegion[] {
    // TODO: implement per DESIGN.md — pairwise overlap of volumes belonging to different factions,
    // combined by settings.overlapCombination, filtered by settings.contestThreshold.
    void this.influence;
    void this.settings;
    throw new Error('WarfrontCalculator.contestedRegions not implemented');
  }

  /**
   * The competence floor a site starts a run at, before any Sancient arrives.
   *
   * This is the number that carries the last run's consequences into this one. A site sitting in a
   * contested volume is harder from the first second, and nothing in the run caused that.
   */
  competenceFloorAt(_siteId: SiteId, _volumes: readonly InfluenceVolume[]): number {
    // TODO: implement per DESIGN.md — combine every volume's contribution at the site's position,
    // apply contestedFloorMultiplier where factions differ, then add the site's own
    // permanentCompetenceFloor (which permanent Sancient jacks have already raised, irreversibly).
    throw new Error('WarfrontCalculator.competenceFloorAt not implemented');
  }
}
