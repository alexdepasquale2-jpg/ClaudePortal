import { describe, expect, it } from 'vitest';
import {
  ANOMALIES,
  ANOMALY_RATE,
  ARCHETYPES,
  ARCH_WEIGHTS,
  BANKS,
  SPECIES_COUNT,
  allSpecies,
  childPath,
  childSeed,
  deriveBank,
  describeSpecies,
  dominantArch,
  hash,
  makeNode,
  parentPath,
  parseSpecies,
  properName,
  rng,
  speciesKey,
  speciesTitle,
  tierOf,
  word,
  type Anomaly,
  type Arch,
} from '../src/engine/procgen';

const SAMPLE = 60_000;

describe('hash', () => {
  it('is deterministic and unsigned 32-bit', () => {
    for (const s of ['', 'a', 'recurse', '0.1.2.3', '\u{1f300}']) {
      const h = hash(s);
      expect(h).toBe(hash(s));
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });

  it('separates similar inputs', () => {
    expect(hash('node:0')).not.toBe(hash('node:1'));
    expect(hash('0.1')).not.toBe(hash('01'));
  });
});

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = rng(9001);
    const b = rng(9001);
    for (let i = 0; i < 200; i++) expect(a()).toBe(b());
  });

  it('stays in [0,1) and is roughly uniform', () => {
    const r = rng(4242);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      buckets[Math.floor(x * 10)]++;
    }
    for (const b of buckets) expect(Math.abs(b - 10_000) / 10_000).toBeLessThan(0.05);
  });

  it('different seeds give different streams', () => {
    const a = rng(1);
    const b = rng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a() === b()) same++;
    expect(same).toBe(0);
  });
});

describe('word grammar', () => {
  it('produces non-empty capitalised pronounceable words', () => {
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const w = word(r, 1 + (i % 3));
      expect(w.length).toBeGreaterThan(0);
      expect(w[0]).toBe(w[0].toUpperCase());
      expect(/^[A-Za-z]+$/.test(w)).toBe(true);
    }
  });

  it('is deterministic for a seed', () => {
    expect(word(rng(55), 3)).toBe(word(rng(55), 3));
    expect(properName(rng(55))).toBe(properName(rng(55)));
  });

  it('generates a large name-space', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(properName(rng(i)));
    expect(seen.size).toBeGreaterThan(18_000);
  });

  it('derived banks past the shipped three are usable', () => {
    for (const i of [3, 4, 11]) {
      const bank = deriveBank(i, 12345);
      expect(bank.ON.length).toBeGreaterThan(0);
      expect(bank.NU.length).toBeGreaterThan(0);
      expect(bank.CO.length).toBeGreaterThan(0);
      const w = word(rng(1), 2, bank);
      expect(/^[A-Za-z]+$/.test(w)).toBe(true);
    }
    // shipped banks are returned as-is
    expect(deriveBank(1, 0)).toBe(BANKS[1]);
  });

  it('swapping banks changes the name-space', () => {
    const a = word(rng(123), 3, BANKS[0]);
    const b = word(rng(123), 3, BANKS[1]);
    expect(a).not.toBe(b);
  });
});

describe('archetype distribution', () => {
  const counts = Object.fromEntries(ARCHETYPES.map((a) => [a, 0])) as Record<Arch, number>;
  let total = 0;
  for (let i = 0; i < SAMPLE; i++) {
    const node = makeNode(String(i), hash('arch:' + i), 1);
    for (const g of node.gens) {
      counts[g.arch]++;
      total++;
    }
  }

  it('matches the design weights within a couple of percent', () => {
    const weightTotal = ARCHETYPES.reduce((a, k) => a + ARCH_WEIGHTS[k], 0);
    for (const a of ARCHETYPES) {
      const expected = ARCH_WEIGHTS[a] / weightTotal;
      const actual = counts[a] / total;
      expect(Math.abs(actual - expected)).toBeLessThan(0.01);
      // and relatively close too, so the rare ones are checked properly
      expect(Math.abs(actual - expected) / expected).toBeLessThan(0.05);
    }
  });

  it('produces every archetype', () => {
    for (const a of ARCHETYPES) expect(counts[a]).toBeGreaterThan(0);
  });
});

describe('anomaly rate', () => {
  const counts: Record<string, number> = { none: 0 };
  for (const a of ANOMALIES) counts[a] = 0;
  for (let i = 0; i < SAMPLE; i++) {
    const node = makeNode(String(i), hash('anom:' + i), 2);
    counts[node.anomaly ?? 'none']++;
  }
  const anomalous = SAMPLE - counts.none;

  it('is near one in twelve', () => {
    const rate = anomalous / SAMPLE;
    expect(Math.abs(rate - ANOMALY_RATE)).toBeLessThan(0.006);
  });

  it('produces all four types', () => {
    for (const a of ANOMALIES) expect(counts[a]).toBeGreaterThan(anomalous * 0.1);
  });

  it('honours an overridden rate', () => {
    let n = 0;
    for (let i = 0; i < 20_000; i++) {
      if (makeNode(String(i), hash('x:' + i), 1, { anomalyRate: 1 / 6 }).anomaly) n++;
    }
    expect(Math.abs(n / 20_000 - 1 / 6)).toBeLessThan(0.012);
  });

  it('can be switched off entirely', () => {
    for (let i = 0; i < 500; i++) {
      expect(makeNode(String(i), hash('z:' + i), 1, { anomalyRate: 0 }).anomaly).toBe(null);
    }
  });
});

describe('anomaly effects', () => {
  function nodeWith(anomaly: Anomaly, seedTag: string) {
    for (let i = 0; i < 200_000; i++) {
      const n = makeNode('x', hash(seedTag + i), 3);
      if (n.anomaly === anomaly) return n;
    }
    throw new Error('no ' + anomaly + ' found');
  }

  it('mirror flattens the cost curve and dims output', () => {
    const n = nodeWith('mirror', 'm');
    // gr = 1 + (gr-1)*0.55 puts every ratio under the un-anomalous floor
    for (const g of n.gens) expect(g.gr).toBeLessThan(1.18);
  });

  it('echo flattens costs much further than mirror', () => {
    const echo = nodeWith('echo', 'e');
    for (const g of echo.gens) expect(g.gr - 1).toBeLessThan(0.06);
  });

  it('bloom appends a fifth generator', () => {
    const n = nodeWith('bloom', 'b');
    expect(n.gens.length).toBe(5);
    expect(n.gens[4].base).toBeCloseTo(n.gens[3].base * 4, 9);
    expect(n.gens[4].c0).toBeCloseTo(n.gens[3].c0 * 24, 9);
  });

  it('the grafting law makes bloom append two', () => {
    for (let i = 0; i < 200_000; i++) {
      const n = makeNode('x', hash('bd' + i), 3, { bloomDouble: true });
      if (n.anomaly === 'bloom') {
        expect(n.gens.length).toBe(6);
        return;
      }
    }
    throw new Error('no bloom found');
  });

  it('void leaves the generator table alone', () => {
    const n = nodeWith('void', 'v');
    expect(n.gens.length).toBe(4);
  });
});

describe('taxonomy', () => {
  it('has exactly 6 x 4 x 5 species', () => {
    expect(SPECIES_COUNT).toBe(120);
    const all = allSpecies();
    expect(all.length).toBe(120);
    expect(new Set(all).size).toBe(120);
  });

  it('round-trips species keys', () => {
    for (const key of allSpecies()) {
      const p = parseSpecies(key);
      expect(speciesKey(p.tier, p.arch, p.anomaly)).toBe(key);
      expect(speciesTitle(key).length).toBeGreaterThan(0);
    }
  });

  it('assigns tiers by depth', () => {
    expect(tierOf(0)).toBe('surface');
    expect(tierOf(1)).toBe('shallow');
    expect(tierOf(2)).toBe('shallow');
    expect(tierOf(3)).toBe('deep');
    expect(tierOf(5)).toBe('deep');
    expect(tierOf(6)).toBe('abyssal');
    expect(tierOf(400)).toBe('abyssal');
  });

  it('classifies every generated node into a real species', () => {
    const valid = new Set(allSpecies());
    for (let i = 0; i < 5000; i++) {
      const node = makeNode(String(i), hash('t' + i), i % 9);
      expect(valid.has(node.species)).toBe(true);
    }
  });

  it('a long enough sample discovers the whole taxonomy', () => {
    const seen = new Set<string>();
    for (let depth = 0; depth <= 7 && seen.size < 120; depth++) {
      for (let i = 0; i < 60_000 && seen.size < 120; i++) {
        seen.add(makeNode(String(i), hash(`full:${depth}:${i}`), depth).species);
      }
    }
    expect(seen.size).toBe(120);
  });

  it('dominant archetype prefers the deepest generator on a tie', () => {
    const gens = [{ arch: 'steady' }, { arch: 'pulse' }] as any;
    expect(dominantArch(gens)).toBe('pulse');
  });

  it('descriptions are templated, non-empty and mention the specimen', () => {
    for (const key of allSpecies()) {
      const d = describeSpecies(key, 'Threxil');
      expect(d.startsWith('Threxil is a ')).toBe(true);
      expect(d.length).toBeGreaterThan(60);
      const { anomaly } = parseSpecies(key);
      expect(/anomaly/.test(d)).toBe(anomaly !== null);
    }
  });
});

describe('determinism of the tree', () => {
  it('the same root seed grows the same children', () => {
    const rootA = makeNode('', 777, 0);
    const rootB = makeNode('', 777, 0);
    expect(rootA.name).toBe(rootB.name);
    expect(rootA.species).toBe(rootB.species);
    for (let g = 0; g < rootA.gens.length; g++) {
      const sa = childSeed(rootA.seed, g);
      const sb = childSeed(rootB.seed, g);
      expect(sa).toBe(sb);
      expect(makeNode(childPath('', g), sa, 1).name).toBe(makeNode(childPath('', g), sb, 1).name);
    }
  });

  it('sibling doors lead somewhere different', () => {
    const seeds = new Set<number>();
    for (let g = 0; g < 5; g++) seeds.add(childSeed(12345, g));
    expect(seeds.size).toBe(5);
  });

  it('paths compose and decompose', () => {
    expect(childPath('', 2)).toBe('2');
    expect(childPath('2', 0)).toBe('2.0');
    expect(parentPath('2.0.3')).toBe('2.0');
    expect(parentPath('2')).toBe('');
    expect(parentPath('')).toBe(null);
  });

  it('generated numbers are always finite and positive', () => {
    for (let i = 0; i < 20_000; i++) {
      const n = makeNode(String(i), hash('f' + i), i % 12);
      expect(Number.isFinite(n.currency)).toBe(true);
      expect(n.hue).toBeGreaterThanOrEqual(0);
      expect(n.hue).toBeLessThan(360);
      for (const g of n.gens) {
        expect(g.base).toBeGreaterThan(0);
        expect(g.c0).toBeGreaterThan(0);
        expect(g.gr).toBeGreaterThan(1);
        expect(Number.isFinite(g.base * g.c0 * g.gr)).toBe(true);
      }
      expect(n.sigil.branches).toBeGreaterThanOrEqual(2);
      expect(n.sigil.shrink).toBeGreaterThan(0);
      expect(n.sigil.shrink).toBeLessThan(1);
    }
  });
});
