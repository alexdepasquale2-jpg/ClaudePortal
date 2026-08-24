import type { Faction, NobotGroupId } from '@core/types/Vocabulary';

/**
 * Persisted faction state: standing, and per-group Nobot radicalisation.
 *
 * This lives in `campaign` rather than `gameplay` for a concrete reason. The Faction menu has to
 * render radicalisation meters (ADR-0004 makes that legibility a requirement, not a nicety), and
 * `ui` cannot import `gameplay`. Attitudes and radicalisation are campaign state anyway — they
 * accumulate across runs and outlive every one of them — so this is where they belong.
 *
 * `gameplay` reads these types too; that direction is allowed.
 */
export type Attitude = 'hostile' | 'wary' | 'neutral' | 'cooperative';

export interface FactionStanding {
  readonly faction: Faction;
  readonly attitude: Attitude;
  /** -1..1. Drives the attitude band. */
  readonly standing: number;
}

/**
 * One Nobot group's persisted state.
 *
 * `threshold` is carried alongside `radicalisation` on purpose: the meter must show the LINE, not
 * just the level. A bar with no marked threshold is not a warning, and an unwarned betrayal reads
 * as arbitrary.
 */
export interface NobotGroupStanding {
  readonly groupId: NobotGroupId;
  readonly displayName: string;
  readonly radicalisation: number;
  readonly threshold: number;
  readonly armed: boolean;
  readonly betrayed: boolean;
  readonly resolvedOperations: number;
}

export const isApproachingBetrayal = (group: NobotGroupStanding, margin = 0.15): boolean =>
  !group.betrayed && group.radicalisation >= group.threshold - margin;
