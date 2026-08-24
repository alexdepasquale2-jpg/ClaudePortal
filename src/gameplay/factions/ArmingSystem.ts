import type { MaterialCounts, NobotGroupId } from '@core/types/Vocabulary';

/**
 * Arming a Nobot group with scavenged neutrino tech.
 *
 * DESIGN.md: "Player can arm them with scavenged neutrino tech. While newly armed they act as
 * temporary allies/distractors."
 *
 * The decision has to be real, which means the cost cannot be only material. ADR-0004 makes the
 * real cost radicalisation: arming is a debt, incurred now, paid later at a time you do not choose.
 * A permanently loyal ally would be a strictly-good pickup and therefore not a decision at all.
 *
 * Arming a group that has already betrayed you is refused. They do not want your tech; they want
 * your node.
 */
export interface ArmingCost {
  readonly materials: MaterialCounts;
  /** Radicalisation added immediately. Handing out weapons is itself a provocation. */
  readonly radicalisationAdded: number;
}

export class ArmingSystem {
  canArm(_groupId: NobotGroupId, _available: MaterialCounts): boolean {
    // TODO: implement per DESIGN.md — refuse betrayed groups outright; check affordability.
    throw new Error('ArmingSystem.canArm not implemented');
  }

  costFor(_groupId: NobotGroupId): ArmingCost {
    // TODO: implement per DESIGN.md — materials plus template.radicalisationPerArming.
    throw new Error('ArmingSystem.costFor not implemented');
  }

  /**
   * Arm a group. They become allies immediately and start counting immediately.
   * The player MUST be shown the radicalisation cost before this is called — an invisible debt is
   * not a decision.
   */
  arm(_groupId: NobotGroupId): void {
    // TODO: implement per DESIGN.md — mark armed, apply radicalisationPerArming, emit 'nobot/armed'.
    throw new Error('ArmingSystem.arm not implemented');
  }
}
