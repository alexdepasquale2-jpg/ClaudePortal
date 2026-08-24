import { describe, expect, it } from 'vitest';
import { loadNobotGroupTemplates } from '@core/data/factions/NobotGroupTemplate';
import { isApproachingBetrayal } from '@campaign/FactionStanding';
import { nobotGroupId } from '@core/types/Vocabulary';

/**
 * ADR-0004: arming a Nobot group is a debt, not a purchase.
 *
 * The rate is unchosen (docs/GAPS.md), so the accumulation tests are todo. What IS testable now is
 * the data guarantee that arming is always a decision, and the warning-band helper the Faction menu
 * depends on — because an unwarned betrayal reads as arbitrary rather than as consequence.
 */
describe('Nobot group templates', () => {
  it('never starts a group already past its betrayal threshold', () => {
    // A group that betrays on the first arming would make arming not a decision at all.
    for (const template of loadNobotGroupTemplates()) {
      expect(template.startingRadicalisation).toBeLessThan(template.betrayalThreshold);
    }
  });

  it('makes every arming cost something', () => {
    for (const template of loadNobotGroupTemplates()) {
      expect(template.radicalisationPerArming).toBeGreaterThan(0);
      expect(template.radicalisationPerResolvedOperation).toBeGreaterThan(0);
    }
  });
});

describe('isApproachingBetrayal', () => {
  it('warns inside the margin', () => {
    const group = {
      groupId: nobotGroupId('group-1'),
      displayName: 'Scavenger Cell',
      radicalisation: 0.68,
      threshold: 0.75,
      armed: true,
      betrayed: false,
      resolvedOperations: 5,
    };
    expect(isApproachingBetrayal(group)).toBe(true);
  });

  it('does not warn well below the threshold', () => {
    const group = {
      groupId: nobotGroupId('group-1'),
      displayName: 'Scavenger Cell',
      radicalisation: 0.2,
      threshold: 0.75,
      armed: true,
      betrayed: false,
      resolvedOperations: 1,
    };
    expect(isApproachingBetrayal(group)).toBe(false);
  });

  it('stops warning about a group that has already turned', () => {
    const group = {
      groupId: nobotGroupId('group-1'),
      displayName: 'Scavenger Cell',
      radicalisation: 0.9,
      threshold: 0.75,
      armed: true,
      betrayed: true,
      resolvedOperations: 9,
    };
    expect(isApproachingBetrayal(group)).toBe(false);
  });
});

describe('RadicalisationSystem', () => {
  it.todo('raises radicalisation only when an operation resolves, never mid-run');
  it.todo('banks nothing for a run that is still in progress');
  it.todo('multiplies the increase by the Sancient accelerant when one arrived');
  it.todo('leaves groups not involved in the run untouched');
  it.todo('fires BetrayalTrigger exactly once when the threshold is crossed');
  it.todo('never lowers radicalisation below zero or raises it above one');
  it.todo('keeps a betrayed group betrayed regardless of later decay');
});
