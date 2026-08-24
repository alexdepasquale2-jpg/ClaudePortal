import type { NobotGroupTemplate } from '@core/data/factions/NobotGroupTemplate';
import type { NobotGroupId, SiteId } from '@core/types/Vocabulary';
import type { Nobot } from './Nobot';

/**
 * A Nobot group — the unit that actually matters.
 *
 * ADR-0004: radicalisation is per-group and lives on the campaign graph. Arming this group in one
 * run changes what a LATER run walks into, which is the core concept applied to a faction rather
 * than to terrain.
 *
 * `resolvedOperations` is the counter radicalisation is driven by, and it only increments when an
 * operation RESOLVES — not moment to moment. The debt is incurred by the run, not by the moment.
 */
export interface NobotGroupState {
  readonly id: NobotGroupId;
  readonly template: NobotGroupTemplate;
  readonly homeSiteId: SiteId;
  /** 0..1. Crossing template.betrayalThreshold fires BetrayalTrigger. */
  readonly radicalisation: number;
  readonly armed: boolean;
  readonly betrayed: boolean;
  /** Operations this group has taken part in that reached a resolution. */
  readonly resolvedOperations: number;
  /** Live members, session-only. */
  readonly members: readonly Nobot[];
}

export const isAllied = (group: NobotGroupState): boolean => group.armed && !group.betrayed;

export const radicalisationRemaining = (group: NobotGroupState): number =>
  Math.max(0, group.template.betrayalThreshold - group.radicalisation);
