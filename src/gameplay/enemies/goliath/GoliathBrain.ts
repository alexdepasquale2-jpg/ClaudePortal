import type { Updatable } from '@core/time/RunClock';
import type { CompetenceProfile } from './LethalityCompetence';
import type { Goliath } from './Goliath';

/**
 * How a Goliath behaves, given how competent it currently is.
 *
 * The states matter because the reversal is a state transition the player can SEE. An incompetent
 * machine wanders, fires wildly, and does not track. A competent one turns, acquires, waits, and
 * fires — in that order, visibly, with the wait being the part that makes it frightening.
 *
 * The brain reads a CompetenceProfile every tick rather than holding one. When a Sancient jacks
 * this machine, the very next tick uses the new profile, and the transition is immediate.
 */
export type GoliathState =
  /** Wandering. Not aware of the player. */
  | 'idle'
  /** Heard something. Moving toward it, badly. */
  | 'investigating'
  /** Sees the player. An incompetent machine goes straight from here to firing. */
  | 'acquiring'
  /** The competent-only state. It has a firing solution and is waiting for the right moment. */
  | 'waiting'
  | 'firing'
  | 'repositioning'
  | 'destroyed';

export class GoliathBrain implements Updatable {
  private state: GoliathState = 'idle';

  constructor(private readonly goliath: Goliath) {}

  get currentState(): GoliathState {
    return this.state;
  }

  /** Fresh profile every tick. Never cache this. */
  setCompetence(_profile: CompetenceProfile): void {
    // TODO: implement per DESIGN.md — a profile that crosses the competence threshold moves the
    // machine into 'waiting' rather than 'firing'; that pause IS the reversal.
    void this.goliath;
    throw new Error('GoliathBrain.setCompetence not implemented');
  }

  /** Noise it heard this tick, from the NoiseSystem. */
  hearNoise(_perceived: number, _origin: { x: number; y: number; z: number }): void {
    // TODO: implement per DESIGN.md — a competent machine investigates precisely; an incompetent
    // one wanders in roughly the right direction.
    throw new Error('GoliathBrain.hearNoise not implemented');
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — run the state machine using the current CompetenceProfile:
    // aimError widens shots, acquireDelay creates the wait, leadsTarget decides whether it fires at
    // where you are or where you were, usesCover decides whether it walks into the open.
    void this.state;
    throw new Error('GoliathBrain.update not implemented');
  }
}
