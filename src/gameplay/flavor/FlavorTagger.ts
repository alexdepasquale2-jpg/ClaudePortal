import type { EventBus } from '@core/events/EventBus';
import type { VerbToTagRule } from '@core/data/flavor/FlavorTagDefinition';
import type { FlavorTag } from '@core/types/Vocabulary';

/**
 * Turns tracked verbs into exactly one active tag.
 *
 * "Exactly one" is the rule. Two simultaneous tags would mean two simultaneous mechanical
 * consequences, and the design locks one consequence per tag precisely so the player can hold in
 * their head what their play style is currently costing and buying them.
 *
 * Tags must be sticky enough not to flicker. A tag that changes every few seconds is a label the
 * player learns to ignore, and an ignored label with a mechanical consequence attached is worse
 * than no label at all.
 */
export class FlavorTagger {
  private active: FlavorTag | null = null;

  constructor(
    private readonly events: EventBus,
    private readonly rules: readonly VerbToTagRule[],
  ) {}

  get activeTag(): FlavorTag | null {
    return this.active;
  }

  /** Score every tag from the current verb counts. Exposed so the HUD can show the runner-up. */
  score(_verbCounts: ReadonlyMap<string, number>): ReadonlyMap<FlavorTag, number> {
    // TODO: implement per DESIGN.md — sum weightPerVerb per matching verb, per rule.
    void this.rules;
    throw new Error('FlavorTagger.score not implemented');
  }

  /**
   * Recompute the active tag. Emits 'flavor/tagChanged' only on an actual change.
   * Must apply hysteresis: the leader has to beat the incumbent by a margin to take over.
   */
  evaluate(_verbCounts: ReadonlyMap<string, number>): FlavorTag | null {
    // TODO: implement per DESIGN.md
    void this.events;
    void this.active;
    throw new Error('FlavorTagger.evaluate not implemented');
  }

  reset(): void {
    this.active = null;
  }
}
