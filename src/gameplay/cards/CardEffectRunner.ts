import type { CardEffect } from '@core/data/cards/InRunCard';

/**
 * Applies card effects to live run stats.
 *
 * Effects are applied to a SESSION stat block, never to a persisted one. The distinction is what
 * keeps the reset honest: if a card wrote into anything the campaign save can see, resetting the
 * card would not undo it.
 *
 * Order matters and is fixed: all `set` first, then all `add`, then all `multiply`. Without a fixed
 * order the same two cards taken in a different sequence would produce different numbers, and
 * players would (correctly) call that a bug.
 */
export interface RunStats {
  [statId: string]: number;
}

export class CardEffectRunner {
  private readonly base: RunStats;
  private current: RunStats;

  constructor(base: RunStats) {
    this.base = { ...base };
    this.current = { ...base };
  }

  get stats(): Readonly<RunStats> {
    return this.current;
  }

  /** Recompute every stat from base plus all active effects. */
  recompute(_effects: readonly CardEffect[]): void {
    // TODO: implement per DESIGN.md — start from base, apply set, then add, then multiply.
    // Recomputing from base each time (rather than mutating) is what makes a card removable and a
    // reset exact.
    void this.base;
    throw new Error('CardEffectRunner.recompute not implemented');
  }

  /** Back to the run's starting values. */
  reset(): void {
    this.current = { ...this.base };
  }
}
