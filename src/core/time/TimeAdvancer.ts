import type { SeededRandom } from '../utilities/SeededRandom';

/**
 * Advances campaign time between runs.
 *
 * The campaign is not simulated continuously — it advances in discrete steps when a run resolves.
 * This is what makes production, pipeline throughput and Nobot radicalisation feel like they
 * happened *while you were away*, without running a background simulation the player never sees.
 *
 * ADR-0004: radicalisation rises when an operation RESOLVES, not moment to moment. This class is
 * where that "resolved" boundary is turned into elapsed campaign time.
 */
export interface CampaignStep {
  /** How much campaign time this run consumed. */
  readonly elapsedTicks: number;
  /** Deterministic stream for anything stochastic in the advance. */
  readonly rng: SeededRandom;
}

export interface CampaignAdvanceable {
  /** Apply `ticks` of campaign time. Must be idempotent per (state, ticks). */
  advance(step: CampaignStep): void;
}

export class TimeAdvancer {
  private readonly subjects: CampaignAdvanceable[] = [];
  private totalTicks = 0;

  /** Campaign ticks elapsed since the campaign began. */
  get elapsedTicks(): number {
    return this.totalTicks;
  }

  register(subject: CampaignAdvanceable): void {
    this.subjects.push(subject);
  }

  /**
   * Advance every registered subject. Order is registration order and is deliberate: production
   * before pipelines before factions, so materials produced this step can move this step.
   */
  advance(_step: CampaignStep): void {
    // TODO: implement per DESIGN.md — apply the step to each subject in order, accumulate ticks,
    // and emit whatever crossed a threshold (production complete, radicalisation past betrayal).
    throw new Error('TimeAdvancer.advance not implemented');
  }

  /** How many campaign ticks a run of the given wall-clock duration is worth. */
  ticksForRun(_durationMs: number): number {
    // TODO: implement per DESIGN.md — the rate is unspecified; see docs/GAPS.md.
    throw new Error('TimeAdvancer.ticksForRun not implemented');
  }
}
