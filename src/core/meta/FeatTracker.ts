import type { RunEndType } from '../types/Vocabulary';

/**
 * Accumulates the metrics feats are measured against.
 *
 * Two accumulation modes exist because the design splits them: `single-run` metrics reset when a run
 * starts, `campaign-total` metrics never reset. Mixing them would let a single lucky run unlock a
 * feat meant to represent a career.
 *
 * Metrics are recorded during a run but only COMMITTED when the run resolves — a run abandoned
 * mid-flight must not bank progress toward an Extracted-track feat.
 */
export interface MetricSnapshot {
  readonly singleRun: Readonly<Record<string, number>>;
  readonly campaignTotal: Readonly<Record<string, number>>;
}

export class FeatTracker {
  private singleRun = new Map<string, number>();
  private campaignTotal = new Map<string, number>();

  /** Add to a metric for the run currently in progress. */
  record(_metric: string, _amount = 1): void {
    // TODO: implement per DESIGN.md
    throw new Error('FeatTracker.record not implemented');
  }

  /** Wipe single-run metrics. Called by run/started. */
  beginRun(): void {
    this.singleRun = new Map();
  }

  /**
   * Fold this run's metrics into campaign totals under the given end type.
   * Called by run/resolved and nowhere else — an uncommitted run banks nothing.
   */
  commitRun(_endType: RunEndType): void {
    // TODO: implement per DESIGN.md
    throw new Error('FeatTracker.commitRun not implemented');
  }

  snapshot(): MetricSnapshot {
    return {
      singleRun: Object.fromEntries(this.singleRun),
      campaignTotal: Object.fromEntries(this.campaignTotal),
    };
  }

  restore(snapshot: MetricSnapshot): void {
    this.singleRun = new Map(Object.entries(snapshot.singleRun));
    this.campaignTotal = new Map(Object.entries(snapshot.campaignTotal));
  }
}
