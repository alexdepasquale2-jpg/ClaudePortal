import { assertNever, type FlavorTag } from '@core/types/Vocabulary';

/**
 * The half of the flavor system that makes it legal.
 *
 * DESIGN.md: "applies exactly one locked mechanical consequence per tag. Labels without
 * consequences are forbidden."
 *
 * The switch below is exhaustive over FlavorTag. That is the enforcement: add a sixth tag to the
 * union without giving it a consequence here and the build fails. The rule is not a review note, it
 * is a typecheck.
 *
 * The five consequences themselves are NOT YET CHOSEN — see docs/GAPS.md. They are deliberately
 * left throwing rather than given placeholder effects, because a placeholder consequence IS the
 * "label without a consequence" the design forbids: it would ship as a tag that appears to do
 * something and does not.
 */
export interface TagConsequence {
  readonly tag: FlavorTag;
  readonly description: string;
  apply(): void;
  revoke(): void;
}

export class TagConsequenceApplicator {
  private current: TagConsequence | null = null;

  /** Swap the active consequence. Exactly one is ever applied. */
  setActiveTag(tag: FlavorTag | null): void {
    this.current?.revoke();
    this.current = tag === null ? null : TagConsequenceApplicator.consequenceFor(tag);
    this.current?.apply();
  }

  get activeConsequence(): TagConsequence | null {
    return this.current;
  }

  /**
   * The locked consequence for a tag.
   *
   * Exhaustive by construction. Do not add a `default` branch that returns something harmless —
   * that would defeat the entire mechanism.
   */
  static consequenceFor(tag: FlavorTag): TagConsequence {
    switch (tag) {
      case 'Militant':
        // TODO: implement per DESIGN.md — consequence not yet chosen (docs/GAPS.md).
        throw new Error('Militant consequence not chosen — see docs/GAPS.md');
      case 'Logistics':
        // TODO: implement per DESIGN.md — consequence not yet chosen (docs/GAPS.md).
        throw new Error('Logistics consequence not chosen — see docs/GAPS.md');
      case 'Diplomatic':
        // TODO: implement per DESIGN.md — consequence not yet chosen (docs/GAPS.md).
        throw new Error('Diplomatic consequence not chosen — see docs/GAPS.md');
      case 'Subversive':
        // TODO: implement per DESIGN.md — consequence not yet chosen (docs/GAPS.md).
        throw new Error('Subversive consequence not chosen — see docs/GAPS.md');
      case 'Expedition':
        // TODO: implement per DESIGN.md — consequence not yet chosen (docs/GAPS.md).
        throw new Error('Expedition consequence not chosen — see docs/GAPS.md');
      default:
        return assertNever(tag, 'FlavorTag without a locked mechanical consequence');
    }
  }
}
