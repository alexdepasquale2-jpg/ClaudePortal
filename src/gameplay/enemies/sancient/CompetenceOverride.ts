import type { Vec3 } from '@core/types/Vocabulary';

/**
 * The local competence floor: every source that raises it, combined.
 *
 * Three sources, and they differ in how long they last:
 *
 *   1. the site's baseline, from its biome
 *   2. territory influence overlap — the Warfront, computed before the run even starts
 *   3. Sancient jacks: temporary, or permanent
 *
 * A permanent jack writes into SiteState.permanentCompetenceFloor and is never removed. Everything
 * else here is session state and dies with the run.
 *
 * LethalityCompetence reads the output of this, per Goliath, per tick. This class is where the
 * "local" in "local competence floor" actually means something spatial.
 */
export interface FloorSource {
  readonly id: string;
  readonly centre: Vec3;
  readonly radius: number;
  /** Contribution at the centre, 0..1. */
  readonly contribution: number;
  readonly permanent: boolean;
}

export class CompetenceOverride {
  private readonly sources = new Map<string, FloorSource>();

  constructor(
    /** From the biome and the warfront. Applies everywhere in the site. */
    private readonly baseFloor: number,
  ) {}

  get base(): number {
    return this.baseFloor;
  }

  add(source: FloorSource): void {
    this.sources.set(source.id, source);
  }

  remove(id: string): void {
    const source = this.sources.get(id);
    // A permanent source cannot be removed. That is what permanent means.
    if (source?.permanent) return;
    this.sources.delete(id);
  }

  /** Combined floor at a point, 0..1. */
  floorAt(_position: Vec3): number {
    // TODO: implement per DESIGN.md — resolve docs/GAPS.md first: do overlapping sources add, max,
    // or multiply? The answer changes whether two Sancients are twice as bad or barely worse, and
    // guessing here would settle a design question by accident.
    void this.baseFloor;
    void this.sources;
    throw new Error('CompetenceOverride.floorAt not implemented — see docs/GAPS.md');
  }

  /** Permanent contributions, to be written into SiteState when the run resolves. */
  permanentContributions(): readonly FloorSource[] {
    return [...this.sources.values()].filter((source) => source.permanent);
  }
}
