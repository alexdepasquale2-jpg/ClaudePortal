import type { Updatable } from '@core/time/RunClock';

/**
 * Counts what the player is actually DOING.
 *
 * DESIGN.md: "HUD reads player verbs." Not what the player selected in a menu, not a class they
 * picked — what they did. Shot things, hauled things, armed people, stayed quiet, walked far.
 *
 * The counts are session-only. A player who spent last run building can spend this one sneaking and
 * the HUD follows immediately, because there is nothing persistent to drag.
 */
export class VerbTracker implements Updatable {
  private readonly counts = new Map<string, number>();

  /** Verb ids come from the verb-to-tag mapping data; nothing else may invent one. */
  record(verb: string, amount = 1): void {
    this.counts.set(verb, (this.counts.get(verb) ?? 0) + amount);
  }

  count(verb: string): number {
    return this.counts.get(verb) ?? 0;
  }

  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.counts);
  }

  /** Wiped at the start of every run. */
  reset(): void {
    this.counts.clear();
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — accumulate continuous verbs such as distance-travelled and
    // time-spent-lit, which cannot be recorded as discrete events.
    throw new Error('VerbTracker.update not implemented');
  }
}
