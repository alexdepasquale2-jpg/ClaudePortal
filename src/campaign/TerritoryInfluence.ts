import type { InfluenceVolumeSettings } from '@core/data/campaign/InfluenceVolumeSettings';
import type { Faction, SiteId, Vec2 } from '@core/types/Vocabulary';
import type { Site } from './Site';

/**
 * The influence a lit or owned site projects across the region map.
 *
 * DESIGN.md on the Warfront: "Purely emergent from overlapping territory influence of lit/owned
 * sites. No separate mode." So there is no front-line object anywhere — there is this, and the
 * overlaps between instances of it.
 *
 * Influence is a campaign-level quantity computed on the region map, not in a live site. It is what
 * the World and Region menus draw as "influence bleed", and it is what raises competence floors in
 * contested volumes before a run ever starts.
 */
export interface InfluenceVolume {
  readonly siteId: SiteId;
  readonly faction: Faction;
  readonly centre: Vec2;
  readonly radius: number;
  /** Peak strength at the centre, 0..1. Grows over `growthTicks` after a flip. */
  readonly strength: number;
}

export class TerritoryInfluence {
  constructor(private readonly settings: InfluenceVolumeSettings) {}

  /**
   * The volume a site currently projects. An unowned, unlit site projects nothing — being on the
   * map is not the same as holding ground.
   */
  volumeFor(_site: Site, _currentTick: number): InfluenceVolume | null {
    // TODO: implement per DESIGN.md — radius is baseRadius + radiusPerLitNode * litNodes.length;
    // strength ramps from 0 to peakStrength over growthTicks since heldSinceTick.
    void this.settings;
    throw new Error('TerritoryInfluence.volumeFor not implemented');
  }

  /** Strength of one volume at a point, after falloff. */
  strengthAt(_volume: InfluenceVolume, _point: Vec2): number {
    // TODO: implement per DESIGN.md — apply the configured falloff (linear / smoothstep /
    // inverse-square) from MathHelpers.
    throw new Error('TerritoryInfluence.strengthAt not implemented');
  }

  /** Every faction's influence at a point, for drawing the bleed and for finding contests. */
  sample(_volumes: readonly InfluenceVolume[], _point: Vec2): ReadonlyMap<Faction, number> {
    // TODO: implement per DESIGN.md
    throw new Error('TerritoryInfluence.sample not implemented');
  }
}
