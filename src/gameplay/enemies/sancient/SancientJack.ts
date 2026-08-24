import type { SancientPowerTier } from '@core/data/factions/SancientDefinition';
import type { Updatable } from '@core/time/RunClock';

/**
 * One Sancient reaching into one or more machines.
 *
 * DESIGN.md: "Their power determines how many nodes or groups they can jack simultaneously and for
 * how long. Long-duration multi-jacks are possible. Permanent jacks raise the local competence
 * floor permanently."
 *
 * "Permanently" means exactly that — it is written into SiteState.permanentCompetenceFloor and
 * never lowered. A site you have fought over repeatedly becomes permanently harder, and there is no
 * mechanism anywhere to undo it. That irreversibility is the Consequence pillar applied to
 * difficulty rather than to territory.
 */
export interface ActiveJack {
  readonly targetId: string;
  readonly kind: 'goliath' | 'nobot-group' | 'node';
  /** Null when the jack is permanent. */
  readonly expiresAt: number | null;
  readonly permanent: boolean;
  /** Floor contribution while active, 0..1. */
  readonly floorContribution: number;
}

export class SancientJack implements Updatable {
  private readonly jacks = new Map<string, ActiveJack>();

  constructor(
    readonly sancientId: string,
    private readonly tier: SancientPowerTier,
  ) {}

  get activeCount(): number {
    return this.jacks.size;
  }

  get atCapacity(): boolean {
    return this.jacks.size >= this.tier.maxSimultaneousJacks;
  }

  isJacked(targetId: string): boolean {
    return this.jacks.has(targetId);
  }

  /**
   * Take hold of a target. Refused at capacity rather than silently dropping an existing jack —
   * a Sancient releasing one machine to grab another would read as the reversal ending at random.
   */
  jack(_targetId: string, _kind: ActiveJack['kind'], _now: number, _permanent: boolean): boolean {
    // TODO: implement per DESIGN.md — respect maxSimultaneousJacks, set expiry from
    // tier.jackDurationSeconds (or null when permanent), emit 'sancient/jacked'.
    throw new Error('SancientJack.jack not implemented');
  }

  release(_targetId: string): void {
    // TODO: implement per DESIGN.md — a permanent jack cannot be released; its floor contribution
    // has already been written into the site and is not recoverable.
    throw new Error('SancientJack.release not implemented');
  }

  /** Floor contributions this Sancient is currently making, by target. */
  contributions(): ReadonlyMap<string, number> {
    return new Map([...this.jacks].map(([id, jack]) => [id, jack.floorContribution]));
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — expire timed jacks and emit 'sancient/released'. Permanent
    // jacks never expire.
    throw new Error('SancientJack.update not implemented');
  }
}
