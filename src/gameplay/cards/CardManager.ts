import type { InRunCard } from '@core/data/cards/InRunCard';
import type { SeededRandom } from '@core/utilities/SeededRandom';

/**
 * Draws and holds the in-run card selections.
 *
 * DESIGN.md: "In-run VS-style cards always reset." Cards are the only progression that never
 * touches the campaign graph. That is the line between a card and a tech node, and it is not
 * negotiable: if a card needs to matter tomorrow, it is a tech node.
 *
 * Draws come from a SeededRandom so a run is reproducible from its seed — the same run replayed
 * offers the same cards.
 */
export class CardManager {
  private readonly taken = new Map<string, number>();

  constructor(
    private readonly pool: readonly InRunCard[],
    private readonly rng: SeededRandom,
  ) {}

  /** How many times a card has been taken this run. */
  stacksOf(cardId: string): number {
    return this.taken.get(cardId) ?? 0;
  }

  get selections(): ReadonlyMap<string, number> {
    return new Map(this.taken);
  }

  /** Offer a hand. Excludes cards already at maxStacks. */
  draw(_count: number): readonly InRunCard[] {
    // TODO: implement per DESIGN.md — weighted by rarity band and card weight, no duplicates in
    // one hand, drawn from this.rng so the offer is reproducible.
    void this.pool;
    void this.rng;
    throw new Error('CardManager.draw not implemented');
  }

  take(_cardId: string): void {
    // TODO: implement per DESIGN.md — increment the stack and hand the effects to CardEffectRunner.
    throw new Error('CardManager.take not implemented');
  }

  /** Wipes every selection. Called by CardResetService when the run resolves. */
  reset(): void {
    this.taken.clear();
  }
}
