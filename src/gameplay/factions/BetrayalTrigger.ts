import type { EventBus } from '@core/events/EventBus';
import type { NobotGroupId } from '@core/types/Vocabulary';

/**
 * The moment a group turns.
 *
 * DESIGN.md: "Eventually they betray and want their own protected nodes."
 *
 * Betrayal is permanent and campaign-level. A betrayed group becomes a new contestant for ownership
 * on the graph, which means the world gets more crowded the longer a campaign runs — harder because
 * of what the player did, not because of a difficulty curve. That is the Consequence pillar
 * arriving through the faction system.
 *
 * Firing this must never be the first the player hears of it. NobotBrain's 'wary' stance and the
 * Faction menu's radicalisation meters exist so the turn is foreshadowed; a betrayal out of nowhere
 * reads as arbitrary (ADR-0004, Consequences).
 */
export class BetrayalTrigger {
  constructor(private readonly events: EventBus) {}

  /** Whether a group's radicalisation has crossed its template threshold. */
  shouldFire(_groupId: NobotGroupId, _radicalisation: number, _threshold: number): boolean {
    // TODO: implement per DESIGN.md
    throw new Error('BetrayalTrigger.shouldFire not implemented');
  }

  /** Turn a group. Irreversible — there is deliberately no `unbetray`. */
  fire(_groupId: NobotGroupId): void {
    // TODO: implement per DESIGN.md — mark betrayed on the campaign graph, register the group as a
    // faction that contests nodes, and emit 'nobot/betrayed'.
    void this.events;
    throw new Error('BetrayalTrigger.fire not implemented');
  }
}
