import type { Vec3 } from '@core/types/Vocabulary';

/**
 * One Nobot.
 *
 * Nobots are not machines that forgot — they are people who stayed. Unarmed they are scenery.
 * Armed with scavenged neutrino tech they are the best distraction in the hole. Radicalised past
 * the threshold they want their own protected nodes, and yours is a node.
 *
 * State lives on the GROUP, not the individual (ADR-0004): radicalisation is a per-group value on
 * the campaign graph, because it accumulates across runs and an individual does not.
 */
export interface Nobot {
  readonly id: string;
  readonly groupId: string;
  readonly position: Vec3;
  readonly health: number;
  readonly armed: boolean;
}
