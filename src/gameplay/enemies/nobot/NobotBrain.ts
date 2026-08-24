import type { Updatable } from '@core/time/RunClock';
import type { NobotGroupState } from './NobotGroup';

/**
 * How a Nobot group behaves, given how radicalised it is.
 *
 * Three stances, and the transition between the second and third is the point of the whole system:
 *
 *  - unarmed: scenery. Keeps away from fights it cannot join.
 *  - allied: fights alongside you, draws fire, holds a perimeter. Genuinely useful.
 *  - betrayed: wants its own protected nodes. Contests yours.
 *
 * The design gives "they want your node" primarily to Sancients and to post-betrayal Nobots. That
 * shared line is deliberate: the two things that turn on you want the same thing, for opposite
 * reasons.
 *
 * A group approaching the threshold should be VISIBLY tense before it turns. A betrayal the player
 * did not see coming reads as arbitrary rather than as consequence (ADR-0004, Consequences).
 */
export type NobotStance = 'unarmed' | 'allied' | 'wary' | 'betrayed';

export class NobotBrain implements Updatable {
  private stance: NobotStance = 'unarmed';

  constructor(private readonly group: NobotGroupState) {}

  get currentStance(): NobotStance {
    return this.stance;
  }

  /** Recompute stance from the group's current radicalisation. */
  refreshStance(): void {
    // TODO: implement per DESIGN.md — 'wary' is the visible warning band below the threshold; it
    // exists so betrayal is foreshadowed rather than sprung.
    void this.group;
    throw new Error('NobotBrain.refreshStance not implemented');
  }

  /** A Sancient's presence accelerates the turn. */
  onSancientPresent(_accelerant: number): void {
    // TODO: implement per DESIGN.md
    throw new Error('NobotBrain.onSancientPresent not implemented');
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — allied groups screen the player and draw fire; betrayed
    // groups move on the nearest lit node, including the player's.
    void this.stance;
    throw new Error('NobotBrain.update not implemented');
  }
}
