import type { FeatDefinition } from '../data/tech/FeatDefinition';
import type { RunEndType } from '../types/Vocabulary';
import type { MetricSnapshot } from './FeatTracker';

/**
 * Decides which feats a resolved run just earned.
 *
 * The load-bearing rule: a feat is only evaluated against the track matching how the run ended.
 * Dying does not progress the Extracted track, however well the run went before it. That separation
 * is what makes dying a way of progressing rather than a way of failing to.
 */
export interface FeatAward {
  readonly featId: string;
  readonly track: RunEndType;
  readonly earnedAtTick: number;
}

export class FeatEvaluator {
  constructor(private readonly definitions: readonly FeatDefinition[]) {}

  /**
   * Feats newly earned by this run. Already-earned feats are excluded, so this is safe to apply
   * directly to the campaign save.
   */
  evaluate(
    _endType: RunEndType,
    _metrics: MetricSnapshot,
    _alreadyEarned: ReadonlySet<string>,
  ): readonly FeatAward[] {
    // TODO: implement per DESIGN.md — filter definitions to the matching track, read the metric from
    // the correct accumulation bucket, compare against threshold, skip anything already earned.
    throw new Error('FeatEvaluator.evaluate not implemented');
  }

  get trackedMetrics(): readonly string[] {
    return [...new Set(this.definitions.map((definition) => definition.metric))];
  }
}
