import type { CampaignAdvanceable, CampaignStep } from '@core/time/TimeAdvancer';
import type { NobotGroupId } from '@core/types/Vocabulary';
import type { RunResult } from '@campaign/RunResult';

/**
 * The counter that turns allies into enemies.
 *
 * ADR-0004, and note carefully WHEN it moves: radicalisation rises when an operation RESOLVES, not
 * moment to moment during one. A run abandoned halfway banks nothing. The debt is incurred by the
 * run as a whole.
 *
 * That timing is what makes it campaign state rather than run state, and it is why this class is
 * driven by RunResult and by TimeAdvancer rather than by the run clock.
 *
 * Sancients accelerate it. Whether it ever decays is UNRESOLVED — see docs/GAPS.md. A group that
 * can never be de-radicalised makes arming a one-shot decision; one that decays makes it a
 * maintenance chore. Both are defensible, neither is chosen, so `decayPerCampaignTick` is read from
 * data rather than hard-coded here.
 */
export class RadicalisationSystem implements CampaignAdvanceable {
  private readonly values = new Map<NobotGroupId, number>();

  get(groupId: NobotGroupId): number {
    return this.values.get(groupId) ?? 0;
  }

  set(groupId: NobotGroupId, value: number): void {
    this.values.set(groupId, Math.min(1, Math.max(0, value)));
  }

  /**
   * Apply a resolved run. The only place a run raises radicalisation.
   * Groups not involved in the run are untouched.
   */
  applyRunResult(_result: RunResult): void {
    // TODO: implement per DESIGN.md — for each involved group add
    // radicalisationPerResolvedOperation, multiplied by the Sancient accelerant if one arrived;
    // emit 'nobot/radicalised', and fire BetrayalTrigger for any group crossing its threshold.
    throw new Error('RadicalisationSystem.applyRunResult not implemented');
  }

  advance(_step: CampaignStep): void {
    // TODO: implement per DESIGN.md — apply decayPerCampaignTick, where the template allows any.
    throw new Error('RadicalisationSystem.advance not implemented');
  }

  snapshot(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.values);
  }
}
