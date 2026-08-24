import { describe, expect, it } from 'vitest';
import { FLAVOR_TAGS } from '@core/types/Vocabulary';
import { loadVerbToTagMapping, rulesForTag } from '@core/data/flavor/FlavorTagDefinition';
import { TagConsequenceApplicator } from '@gameplay/flavor/TagConsequenceApplicator';

/**
 * DESIGN.md: "Labels without consequences are forbidden."
 *
 * The five consequences are not yet chosen (docs/GAPS.md), and the tests below assert that
 * honestly: every tag currently THROWS rather than silently returning a harmless no-op. A
 * placeholder consequence would be exactly the forbidden thing — a tag that appears to do something
 * and does not.
 *
 * When the five are chosen, `refuses to hand out a consequence that has not been chosen` is the
 * test to delete, and the todos below are the ones to fill in.
 */
describe('FlavorTag vocabulary', () => {
  it('has exactly five tags', () => {
    expect(FLAVOR_TAGS).toHaveLength(5);
  });

  it('makes every tag reachable from at least one verb', () => {
    // A tag no verb can produce is a label with no consequence by another route.
    for (const tag of FLAVOR_TAGS) {
      expect(rulesForTag(tag).length).toBeGreaterThan(0);
    }
  });

  it('gives every rule at least one verb and a stated consequence', () => {
    for (const rule of loadVerbToTagMapping()) {
      expect(rule.verbs.length).toBeGreaterThan(0);
      expect(rule.consequenceSummary.length).toBeGreaterThan(0);
    }
  });
});

describe('TagConsequenceApplicator', () => {
  it('refuses to hand out a consequence that has not been chosen', () => {
    // Deliberate. Throwing is correct until docs/GAPS.md is resolved; a no-op would ship a label
    // with nothing behind it, which the design forbids outright.
    for (const tag of FLAVOR_TAGS) {
      expect(() => TagConsequenceApplicator.consequenceFor(tag)).toThrow(/not chosen/);
    }
  });

  it.todo('applies exactly one consequence at a time');
  it.todo('revokes the previous consequence before applying the next');
  it.todo('applies nothing when no tag is active');
});

describe('FlavorTagger', () => {
  it.todo('activates the highest-scoring tag');
  it.todo('never reports two tags active at once');
  it.todo('requires the challenger to beat the incumbent by a margin before switching');
  it.todo('emits flavor/tagChanged only on an actual change');
  it.todo('resets to no tag at the start of a run');
});
