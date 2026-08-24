import type { SancientPowerTier } from '@core/data/factions/SancientDefinition';
import type { Vec3 } from '@core/types/Vocabulary';

/**
 * Rare. Personally weak. Fully aware of the catalog.
 *
 * A Sancient is not a fight. Its hull and damage are trivial and the data schema refuses to let them
 * be otherwise. What it is, is a change in what every other fight in the room means.
 *
 * Killing one is easy. Reaching one — through the machines it has just made competent — is the
 * problem. That asymmetry is the whole design of the encounter.
 */
export interface Sancient {
  readonly id: string;
  readonly tier: SancientPowerTier;
  readonly position: Vec3;
  readonly health: number;
  /** Ids currently jacked. Length is capped by tier.maxSimultaneousJacks. */
  readonly activeJacks: readonly string[];
  /** Seconds since it arrived. */
  readonly presentFor: number;
}
