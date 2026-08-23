import { describe, expect, it } from 'vitest';
import {
  CATEGORY_LABEL,
  DANGER_LABEL,
  HOUSES,
  LEXICON,
  LEXICON_COUNT,
  MARKS,
  STRATA,
  allDossiers,
  composeAnnals,
  composeLore,
  designationOf,
  lexiconByCategory,
  loreCoverage,
} from '../src/engine/lore';
import {
  ANOMALIES,
  ARCHETYPES,
  SPECIES_COUNT,
  TIERS,
  allSpecies,
  describeSpecies,
  parseSpecies,
} from '../src/engine/procgen';
import { EPOCH_LAWS } from '../src/engine/epochs';
import { newGame } from '../src/engine/state';

describe('designations', () => {
  it('are unique, stable, and encode the taxonomy', () => {
    const seen = new Set<string>();
    for (const key of allSpecies()) {
      const code = designationOf(key);
      expect(code.startsWith('REX-')).toBe(true);
      expect(seen.has(code)).toBe(false);
      seen.add(code);
      expect(designationOf(key)).toBe(code);
    }
    expect(seen.size).toBe(SPECIES_COUNT);
  });
});

describe('composeLore', () => {
  it('is deterministic and keeps the original lead sentence', () => {
    for (const key of allSpecies()) {
      const a = composeLore(key, 'Threxil');
      const b = composeLore(key, 'Threxil');
      expect(a).toEqual(b);
      expect(a.lead).toBe(describeSpecies(key, 'Threxil'));
      expect(a.lead.startsWith('Threxil is a ')).toBe(true);
      expect(a.designation).toBe(designationOf(key));
      expect(a.epithet.startsWith('Threxil ')).toBe(true);
      expect(a.house.id).toBe(parseSpecies(key).arch);
      expect(a.stratum.id).toBe(parseSpecies(key).tier);
      expect(a.mark.id).toBe(parseSpecies(key).anomaly ?? 'none');
      expect(a.fieldNotes.length).toBeGreaterThanOrEqual(2);
      expect(a.relic.name.length).toBeGreaterThan(0);
      expect(a.rite.length).toBeGreaterThan(10);
      expect(a.myth.length).toBeGreaterThan(20);
      expect(a.aliases.length).toBeGreaterThanOrEqual(2);
      expect(DANGER_LABEL[a.danger]).toBeTruthy();
    }
  });

  it('void specimens are interdicted and bloom specimens are at least hostile', () => {
    const voidKey = allSpecies().find((k) => parseSpecies(k).anomaly === 'void')!;
    const bloomKey = allSpecies().find((k) => parseSpecies(k).anomaly === 'bloom')!;
    expect(composeLore(voidKey, 'X').danger).toBe('interdicted');
    expect(['hostile', 'interdicted']).toContain(composeLore(bloomKey, 'X').danger);
  });

  it('changing the specimen name does not change house, mark, or designation', () => {
    const key = 'deep/cascade/void';
    const a = composeLore(key, 'Vaun');
    const b = composeLore(key, 'Other');
    expect(a.designation).toBe(b.designation);
    expect(a.house.name).toBe(b.house.name);
    expect(a.mark.name).toBe(b.mark.name);
    expect(a.epithet).not.toBe(b.epithet);
    expect(a.lead).not.toBe(b.lead);
  });
});

describe('world bible', () => {
  it('covers every house, stratum, mark, law and shipped tongue', () => {
    expect(Object.keys(HOUSES)).toEqual([...ARCHETYPES]);
    expect(Object.keys(STRATA)).toEqual([...TIERS]);
    expect(Object.keys(MARKS)).toEqual(['none', ...ANOMALIES]);
    expect(LEXICON_COUNT).toBe(LEXICON.length);
    expect(LEXICON_COUNT).toBeGreaterThanOrEqual(40);

    const ids = new Set(LEXICON.map((e) => e.id));
    expect(ids.size).toBe(LEXICON.length);
    for (const a of ARCHETYPES) expect(ids.has(`house:${a}`)).toBe(true);
    for (const t of TIERS) expect(ids.has(`stratum:${t}`)).toBe(true);
    for (const m of ['none', ...ANOMALIES]) expect(ids.has(`mark:${m}`)).toBe(true);
    for (const law of EPOCH_LAWS) expect(ids.has(`law:${law.id}`)).toBe(true);
    expect(ids.has('lang:Ordinal')).toBe(true);
    expect(ids.has('cosmo:codex')).toBe(true);

    const grouped = lexiconByCategory();
    for (const cat of Object.keys(CATEGORY_LABEL) as (keyof typeof grouped)[]) {
      expect(grouped[cat].length).toBeGreaterThan(0);
    }
  });

  it('every lexicon article is a real paragraph', () => {
    for (const e of LEXICON) {
      expect(e.title.length).toBeGreaterThan(2);
      expect(e.body.length).toBeGreaterThan(40);
    }
    for (const h of Object.values(HOUSES)) {
      expect(h.motto.length).toBeGreaterThan(0);
      expect(h.creed.length).toBeGreaterThan(40);
    }
  });
});

describe('annals and coverage', () => {
  it('a new save has a founding chronicle and an empty catalogue', () => {
    const state = newGame(7, 1_000);
    const annals = composeAnnals(state);
    expect(annals[0].heading).toBe('Founding');
    expect(annals.some((a) => a.heading === 'The Catalogue')).toBe(true);
    expect(loreCoverage(state.meta.codex)).toEqual({ houses: 0, strata: 0, marks: 0 });
  });

  it('coverage counts distinct axes, not specimens', () => {
    const cover = loreCoverage({
      'surface/steady/none': { arch: 'steady', tier: 'surface', anomaly: null },
      'surface/steady/void': { arch: 'steady', tier: 'surface', anomaly: 'void' },
      'abyssal/cascade/bloom': { arch: 'cascade', tier: 'abyssal', anomaly: 'bloom' },
    });
    expect(cover.houses).toBe(2);
    expect(cover.strata).toBe(2);
    expect(cover.marks).toBe(3);
  });

  it('annals mention laws and genesis when those have happened', () => {
    const state = newGame(3, 0);
    state.progress.laws = ['refraction', 'grafting'];
    state.progress.genesis = 1;
    state.progress.bankIndex = 1;
    state.meta.history.push({
      kind: 'genesis',
      at: 10,
      durationMs: 120_000,
      index: 1,
      deepest: 8,
      nodes: 40,
    });
    const text = composeAnnals(state)
      .map((a) => a.body)
      .join(' ');
    expect(text).toMatch(/Law of Refraction/);
    expect(text).toMatch(/Umbral|renamed/);
    expect(text).toMatch(/Genesis 1/);
  });
});

describe('allDossiers', () => {
  it('emits one dossier per species', () => {
    const all = allDossiers();
    expect(all.length).toBe(SPECIES_COUNT);
    expect(new Set(all.map((d) => d.key)).size).toBe(SPECIES_COUNT);
  });
});
