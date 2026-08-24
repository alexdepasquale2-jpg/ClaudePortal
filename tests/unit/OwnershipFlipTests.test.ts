import { describe, expect, it } from 'vitest';
import { isContested, isHeldBy, unowned } from '@campaign/Ownership';
import { siteId } from '@core/types/Vocabulary';

/**
 * The Consequence pillar's central mechanic.
 *
 * The flip RULES are unresolved (docs/GAPS.md: who receives a site on death, whether an unlit site
 * flips at all, how much grip absorbs), so the behavioural tests are todo. They are named for the
 * invariants they will assert, so the questions stay visible rather than becoming whatever the
 * first implementation happens to do.
 */
describe('Ownership — helpers', () => {
  it('starts a site unowned, ungripped and never flipped', () => {
    const ownership = unowned(siteId('site-1'), 12);
    expect(ownership.holder).toBe('Unowned');
    expect(ownership.grip).toBe(0);
    expect(ownership.flipCount).toBe(0);
    expect(ownership.heldSinceTick).toBe(12);
    expect(isContested(ownership)).toBe(false);
  });

  it('reports contest separately from holding', () => {
    // A site held by one faction and contested by another IS the front line, so the two facts
    // cannot collapse into one.
    const ownership = {
      ...unowned(siteId('site-1')),
      holder: 'Neet' as const,
      contestedBy: ['Goliath' as const],
    };
    expect(isHeldBy(ownership, 'Neet')).toBe(true);
    expect(isContested(ownership)).toBe(true);
  });
});

describe('OwnershipFlip', () => {
  it.todo('flips a lit, unheld site to the player on extraction');
  it.todo('flips a site away from the player when they die holding it');
  it.todo('records a death at a site the player did not hold as contested, not flipped');
  it.todo('leaves ownership unchanged when a run is abandoned with nothing lit');
  it.todo('hands a site abandoned with a lit node to whoever holds most influence over it');
  it.todo('increments flipCount exactly once per actual change of holder');
  it.todo('resets grip and heldSinceTick on a flip');
  it.todo('is a pure function: the same run applied twice yields the same outcome');
  it.todo('gives a betrayed Nobot group a claim that outranks an absent faction');
});
