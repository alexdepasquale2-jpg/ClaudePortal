import { describe, expect, it } from 'vitest';
import { loadGoliathCatalog } from '@core/data/factions/GoliathCatalog';
import { loadSancientPowerTiers } from '@core/data/factions/SancientDefinition';

/**
 * ADR-0003: lethality is a property of the machine, competence is not.
 *
 * The behavioural tests are todo because the competence curve is genuinely unchosen — docs/GAPS.md
 * lists the open questions, and asserting a curve here would settle a design decision by accident.
 *
 * The DATA-SHAPE tests below are real, because ADR-0003's structural half is already true: a
 * catalog entry has nowhere to put a competence value, and it cannot.
 */
describe('LethalityCompetence — data shape (ADR-0003)', () => {
  it('gives no catalog entry a competence, accuracy or skill field', () => {
    // The absence is load-bearing. A catalog that COULD describe competence would eventually be
    // used to author a permanently competent Goliath, and the Panic pillar would quietly die.
    for (const entry of loadGoliathCatalog()) {
      expect(entry).not.toHaveProperty('accuracy');
      expect(entry).not.toHaveProperty('competence');
      expect(entry).not.toHaveProperty('skill');
      expect(entry).not.toHaveProperty('aim');
    }
  });

  it('keeps high-lethality machines highly incompetent at baseline', () => {
    // The inverse relationship is the joke the reversal depends on.
    for (const entry of loadGoliathCatalog()) {
      if (entry.lethality >= 8) expect(entry.baselineIncompetence).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('keeps every Sancient personally weak', () => {
    // "Rare. Personally weak. Fully aware of the catalog." Killing one is easy; reaching one is not.
    for (const tier of loadSancientPowerTiers()) {
      expect(tier.hull).toBeLessThanOrEqual(200);
      expect(tier.damage).toBeLessThanOrEqual(20);
    }
  });

  it('gives higher Sancient tiers broader and longer reach', () => {
    const tiers = [...loadSancientPowerTiers()].sort((a, b) => a.tier - b.tier);
    for (let i = 1; i < tiers.length; i++) {
      const previous = tiers[i - 1]!;
      const current = tiers[i]!;
      expect(current.maxSimultaneousJacks).toBeGreaterThanOrEqual(previous.maxSimultaneousJacks);
      expect(current.jackDurationSeconds).toBeGreaterThanOrEqual(previous.jackDurationSeconds);
    }
  });
});

describe('LethalityCompetence — behaviour', () => {
  it.todo('returns lower competence for higher lethality when the local floor is zero');
  it.todo('returns full competence for every machine when the local floor is one');
  it.todo('raises competence the instant a Sancient jack begins, with no interpolation');
  it.todo('gives a competent machine a non-zero acquireDelay so the wait is visible');
  it.todo('makes an incompetent machine fire at where the target was, not where it is');
  it.todo('keeps a permanently raised floor after the jacking Sancient is destroyed');
  it.todo('reports a significant change when the floor crosses the readability threshold');
});
