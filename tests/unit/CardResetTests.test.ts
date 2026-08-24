import { describe, expect, it } from 'vitest';
import { SeededRandom } from '@core/utilities/SeededRandom';
import { loadCardPool } from '@core/data/cards/InRunCard';
import { CardEffectRunner } from '@gameplay/cards/CardEffectRunner';
import { CardManager } from '@gameplay/cards/CardManager';
import { CardResetService } from '@gameplay/cards/CardResetService';

/**
 * DESIGN.md: "In-run VS-style cards always reset."
 *
 * ALWAYS — on every end type, including abandonment, including the code path nobody remembered to
 * write. CardResetService exists so that rule lives in one place, and these tests are real because
 * the reset path itself is implemented even though drawing is not.
 */
describe('Card pool data', () => {
  it('scopes every card to the run', () => {
    // A card that persisted would be a tech node wearing a card's clothes.
    for (const card of loadCardPool()) {
      expect(card.scope).toBe('run');
    }
  });

  it('gives every card a pillar to serve', () => {
    for (const card of loadCardPool()) {
      expect(['Greed', 'Dread', 'Power', 'Panic', 'Consequence']).toContain(card.pillar);
    }
  });

  it('gives every card at least one effect', () => {
    for (const card of loadCardPool()) {
      expect(card.effects.length).toBeGreaterThan(0);
    }
  });
});

describe('CardResetService', () => {
  const build = () => {
    const manager = new CardManager(loadCardPool(), new SeededRandom(1));
    const effects = new CardEffectRunner({ 'autofire-range': 12, 'backpack-capacity': 100 });
    return { manager, effects, service: new CardResetService(manager, effects) };
  };

  it('clears every selection when the run resolves', () => {
    const { manager, service } = build();
    // Reach past `take` (unimplemented) to the state it maintains, so the reset path is under test
    // rather than the draw path.
    (manager as unknown as { taken: Map<string, number> }).taken.set('deep-pockets', 3);
    expect(manager.stacksOf('deep-pockets')).toBe(3);

    service.onRunResolved();
    expect(manager.stacksOf('deep-pockets')).toBe(0);
    expect(manager.selections.size).toBe(0);
  });

  it('clears selections at the start of a run as a safety net', () => {
    // The end-of-run reset is the intent; this catches any path that skipped it.
    const { manager, service } = build();
    (manager as unknown as { taken: Map<string, number> }).taken.set('wider-sweep', 2);

    service.onRunStarted();
    expect(manager.stacksOf('wider-sweep')).toBe(0);
  });

  it('returns run stats to their starting values', () => {
    const { effects, service } = build();
    (effects as unknown as { current: Record<string, number> }).current['autofire-range'] = 99;

    service.onRunResolved();
    expect(effects.stats['autofire-range']).toBe(12);
    expect(effects.stats['backpack-capacity']).toBe(100);
  });

  it('is idempotent', () => {
    const { manager, effects, service } = build();
    service.onRunResolved();
    service.onRunResolved();
    expect(manager.selections.size).toBe(0);
    expect(effects.stats['autofire-range']).toBe(12);
  });

  it.todo('resets after an Extracted run');
  it.todo('resets after a Died run');
  it.todo('resets after an Abandoned run');
  it.todo('leaves campaign tech unlocks untouched');
});
