import type { GoliathCatalogEntry } from '@core/data/factions/GoliathCatalog';

/**
 * Turns a catalog entry plus a local competence floor into how well a Goliath actually fights.
 *
 * ADR-0003, and the single most important calculation in the game.
 *
 * Lethality is a property of the machine. Competence is NOT — it is a property of whether something
 * is currently telling the machine how to aim. A Goliath's catalog never changes. What changes is
 * the floor beneath it, raised by a Sancient's jack, by overlapping territory influence, or
 * permanently by a permanent jack.
 *
 * The signature moment the whole design points at — "a clownish high-lethality Goliath suddenly
 * turns, acquires, waits, and fires" — is this function returning a different number for the same
 * machine, one tick to the next.
 *
 * The maths is deliberately NOT written yet. docs/GAPS.md lists the open questions: the curve, the
 * units, and whether floors from different sources add, max, or multiply. A placeholder curve here
 * would silently become the design, so it stays unimplemented.
 */
export interface CompetenceInputs {
  readonly catalog: GoliathCatalogEntry;
  /** Combined floor at this Goliath's position, 0..1. */
  readonly localFloor: number;
  /** Whether a Sancient is actively jacking this one right now. */
  readonly jacked: boolean;
}

export interface CompetenceProfile {
  /** How well it uses its catalog, 0..1. */
  readonly competence: number;
  /** Aim error in radians. Falls as competence rises. */
  readonly aimError: number;
  /** Seconds it waits after acquiring before firing. A competent machine WAITS. */
  readonly acquireDelay: number;
  /** Whether it leads a moving target. Incompetent machines fire at where you were. */
  readonly leadsTarget: boolean;
  /** Whether it uses cover and repositions rather than walking in a straight line. */
  readonly usesCover: boolean;
}

export class LethalityCompetence {
  /**
   * Effective competence for a Goliath right now.
   *
   * The inverse relationship must hold: at a floor of zero, higher `lethality` yields LOWER
   * competence (via `baselineIncompetence`). At a floor of one, every machine is fully competent
   * regardless of what it carries — which is why an Ordnance Frame under an Archivist is the
   * worst thing in the game.
   */
  static evaluate(_inputs: CompetenceInputs): CompetenceProfile {
    // TODO: implement per DESIGN.md — resolve the open questions in docs/GAPS.md first:
    //   - the curve from (baselineIncompetence, localFloor) to competence
    //   - how floors from different sources combine: add, max, or multiply
    //   - whether `jacked` is a separate term or simply a raised floor
    throw new Error('LethalityCompetence.evaluate not implemented — see docs/GAPS.md');
  }

  /**
   * Whether a change in competence is large enough that the player must be TOLD.
   *
   * Readability is a design requirement, not polish (ADR-0003, Consequences). If the floor rises
   * and the player cannot see it, the reversal reads as a bug rather than as the Panic pillar.
   * CompetenceWarning subscribes to this.
   */
  static isSignificantChange(_before: number, _after: number): boolean {
    // TODO: implement per DESIGN.md
    throw new Error('LethalityCompetence.isSignificantChange not implemented');
  }
}
