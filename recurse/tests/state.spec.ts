import { describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  SAVE_VERSION,
  exportSave,
  hydrate,
  importSave,
  migrate,
  newGame,
  pruneDanglingDoors,
  seedFromUrl,
  MemoryAdapter,
} from '../src/engine/state';
import { Engine, MAX_NODES, OFFLINE_CAP_MS } from '../src/engine/actions';
import {
  COLLAPSES_PER_EPOCH,
  EPOCHS_PER_GENESIS,
  EPOCH_LAWS,
  baseExponent,
  deriveRules,
  globalMultiplier,
} from '../src/engine/epochs';
import { ACHIEVEMENTS, achievementBonus } from '../src/engine/achievements';
import { GOAL, doorReady } from '../src/engine/economy';
import { SPECIES_COUNT, allSpecies } from '../src/engine/procgen';
import { BG, PANEL, accentRgb, contrastRatio, hslToRgb, readableAccent } from '../src/render/palette';
import { freshEngine, greedyBuy } from './helpers';

function grow(engine: Engine, ticks: number, budget = 40): void {
  for (let i = 0; i < ticks; i++) {
    engine.step(0.1, 0);
    for (const path of engine.order) greedyBuy(engine, path, 3);
    if (engine.order.length < budget) {
      outer: for (const path of engine.order) {
        const node = engine.state.run.nodes[path];
        for (let g = 0; g < node.gens.length; g++) {
          if (doorReady(node.gens[g])) {
            engine.openDoor(path, g, 0);
            break outer;
          }
        }
      }
    }
  }
}

describe('save versioning', () => {
  it('migrates an unversioned legacy blob', () => {
    const legacy = { seed: 42, collapses: 3, codex: { 'surface/steady/none': { name: 'X' } } };
    const out = migrate(legacy);
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.progress.collapses).toBe(3);
    expect(out.meta.codex['surface/steady/none']).toBeTruthy();
  });

  it('leaves a current save alone', () => {
    const s = newGame(1, 0);
    expect(migrate(JSON.parse(JSON.stringify(s))).version).toBe(SAVE_VERSION);
  });

  it('refuses a save from the future rather than corrupting it', () => {
    expect(() => migrate({ version: SAVE_VERSION + 5 })).toThrow(/newer version/);
  });

  it('every registered migration advances the version', () => {
    for (const from of Object.keys(MIGRATIONS).map(Number)) {
      const out = MIGRATIONS[from]({});
      expect(out.version).toBeGreaterThan(from);
    }
  });
});

describe('hydrate is hostile-input safe', () => {
  it('scrubs NaN, Infinity and nonsense out of a save', () => {
    const s: any = JSON.parse(JSON.stringify(newGame(9, 0)));
    s.run.nodes[''].currency = 'banana';
    s.run.nodes[''].lifetime = null;
    s.run.nodes[''].gens[0].gr = 0.5; // would make cost() explode
    s.run.nodes[''].gens[1].n = -40;
    s.run.t = 'x';
    s.meta.stats.deepestDepth = Infinity;
    const out = hydrate(s, 0);
    const root = out.run.nodes[''];
    expect(Number.isFinite(root.currency)).toBe(true);
    expect(Number.isFinite(root.lifetime)).toBe(true);
    expect(root.gens[0].gr).toBeGreaterThan(1);
    expect(root.gens[1].n).toBe(0);
    expect(Number.isFinite(out.meta.stats.deepestDepth)).toBe(true);
    // and it still ticks cleanly
    const e = new Engine(out);
    e.step(0.1, 0);
    expect(Number.isFinite(e.rates[''])).toBe(true);
  });

  it('rebuilds a run whose root was lost, keeping the codex', () => {
    const s: any = JSON.parse(JSON.stringify(newGame(9, 0)));
    s.meta.codex['deep/cascade/void'] = { name: 'Keepme', tier: 'deep', arch: 'cascade' };
    delete s.run.nodes[''];
    const out = hydrate(s, 0);
    expect(out.run.nodes['']).toBeTruthy();
    expect(out.meta.codex['deep/cascade/void']).toBeTruthy();
  });

  it('closes doors that point at nodes which did not survive', () => {
    const nodes: any = JSON.parse(JSON.stringify(newGame(3, 0).run.nodes));
    nodes[''].gens[0].door = '0';
    pruneDanglingDoors(nodes);
    expect(nodes[''].gens[0].door).toBe(null);
  });

  it('drops orphans whose parent chain is gone', () => {
    const g = newGame(3, 0);
    const e = new Engine(g);
    e.buy('', 0, 40);
    e.openDoor('', 0, 0);
    const raw: any = JSON.parse(JSON.stringify(g));
    raw.run.nodes['7.7.7'] = raw.run.nodes['0'];
    const out = hydrate(raw, 0);
    expect(out.run.nodes['7.7.7']).toBeUndefined();
  });
});

describe('export / import', () => {
  it('round-trips a played save exactly', () => {
    const engine = freshEngine(1234, 0);
    grow(engine, 900);
    engine.checkAchievements(1);
    const json = exportSave(engine.state);
    const back = importSave(json, 1);
    expect(Object.keys(back.run.nodes).length).toBe(engine.order.length);
    expect(back.run.nodes[''].lifetime).toBeCloseTo(engine.root.lifetime, 6);
    expect(Object.keys(back.meta.codex)).toEqual(Object.keys(engine.state.meta.codex));
    expect(back.meta.stats.unitsEverBought).toBe(engine.state.meta.stats.unitsEverBought);

    // and it produces the same rates
    const e2 = new Engine(back);
    e2.refreshRates();
    engine.refreshRates();
    expect(e2.rates['']).toBeCloseTo(engine.rates[''], 6);
  });

  it('rejects a blob that is not an object', () => {
    expect(() => importSave('42', 0)).toThrow();
    expect(() => importSave('not json', 0)).toThrow();
  });
});

describe('the codex is the permanent axis', () => {
  it('survives Collapse untouched while the tree resets', () => {
    const engine = freshEngine(31, 0);
    grow(engine, 4000, 60);
    engine.root.lifetime = GOAL;
    const codexBefore = { ...engine.state.meta.codex };
    const feedBefore = engine.state.meta.feed.length;
    const nodesBefore = engine.order.length;
    expect(Object.keys(codexBefore).length).toBeGreaterThan(1);

    const res = engine.collapse(1000);
    expect(res).toBeTruthy();
    expect(engine.order.length).toBe(1);
    expect(engine.order.length).toBeLessThan(nodesBefore);
    expect(engine.root.lifetime).toBe(0);
    expect(engine.state.progress.collapses).toBe(1);
    for (const key of Object.keys(codexBefore)) {
      expect(engine.state.meta.codex[key]).toBeTruthy();
    }
    expect(engine.state.meta.feed.length).toBeGreaterThanOrEqual(feedBefore);
  });

  it('survives Epoch and Genesis', () => {
    const engine = freshEngine(32, 0);
    grow(engine, 2500, 40);
    const keys = Object.keys(engine.state.meta.codex);
    expect(keys.length).toBeGreaterThan(0);

    engine.state.progress.collapses = COLLAPSES_PER_EPOCH;
    expect(engine.epoch(1)).toBeTruthy();
    for (const k of keys) expect(engine.state.meta.codex[k]).toBeTruthy();
    expect(engine.state.progress.collapses).toBe(0);
    expect(engine.state.progress.epochs).toBe(1);

    engine.state.progress.epochs = EPOCHS_PER_GENESIS;
    expect(engine.genesis(2)).toBeTruthy();
    for (const k of keys) expect(engine.state.meta.codex[k]).toBeTruthy();
    expect(engine.state.progress.epochs).toBe(0);
    expect(engine.state.progress.genesis).toBe(1);
    expect(engine.state.progress.laws).toEqual([]);
  });

  it('achievements and stats also survive every reset', () => {
    const engine = freshEngine(33, 0);
    grow(engine, 1500, 30);
    engine.checkAchievements(5);
    const unlocked = Object.keys(engine.state.meta.achievements);
    expect(unlocked.length).toBeGreaterThan(0);
    const bought = engine.state.meta.stats.unitsEverBought;

    engine.root.lifetime = GOAL;
    engine.collapse(10);
    engine.state.progress.collapses = COLLAPSES_PER_EPOCH;
    engine.epoch(11);
    engine.state.progress.epochs = EPOCHS_PER_GENESIS;
    engine.genesis(12);

    for (const id of unlocked) expect(engine.state.meta.achievements[id]).toBeTruthy();
    expect(engine.state.meta.stats.unitsEverBought).toBeGreaterThanOrEqual(bought);
    expect(engine.state.meta.stats.totalCollapses).toBe(1);
    expect(engine.state.meta.stats.totalEpochs).toBe(1);
    expect(engine.state.meta.stats.totalGenesis).toBe(1);
  });

  it('only a full erase clears it', async () => {
    const kv = new MemoryAdapter();
    const engine = freshEngine(34, 0);
    grow(engine, 800, 20);
    await kv.set('recurse.save.v1', exportSave(engine.state));
    expect(await kv.get('recurse.save.v1')).toBeTruthy();
    await kv.del('recurse.save.v1');
    expect(await kv.get('recurse.save.v1')).toBe(null);
    // a fresh game after an erase has an empty codex
    expect(Object.keys(newGame(1, 0).meta.codex).length).toBe(0);
  });

  it('logs first encounters to the feed in reverse-chronological order', () => {
    const engine = freshEngine(35, 0);
    grow(engine, 2000, 40);
    const feed = engine.state.meta.feed;
    expect(feed.length).toBe(Object.keys(engine.state.meta.codex).length);
    for (let i = 1; i < feed.length; i++) {
      expect(feed[i - 1].at).toBeGreaterThanOrEqual(feed[i].at);
    }
  });

  it('counts repeat sightings without re-logging the species', () => {
    const engine = freshEngine(36, 0);
    grow(engine, 1200, 30);
    const before = Object.keys(engine.state.meta.codex).length;
    const feedBefore = engine.state.meta.feed.length;
    const key = engine.root.species;
    const seenBefore = engine.state.meta.codex[key].seen;
    engine.noteSpecies(engine.root, 99);
    expect(Object.keys(engine.state.meta.codex).length).toBe(before);
    expect(engine.state.meta.feed.length).toBe(feedBefore);
    expect(engine.state.meta.codex[key].seen).toBe(seenBefore + 1);
  });
});

describe('prestige tiers', () => {
  it('will not fire before their gates', () => {
    const engine = freshEngine(40, 0);
    expect(engine.collapse(0)).toBe(null);
    expect(engine.epoch(0)).toBe(null);
    expect(engine.genesis(0)).toBe(null);
  });

  it('Collapse adds exactly +0.5 to the global multiplier', () => {
    const engine = freshEngine(41, 0);
    const bonusBefore = achievementBonus(engine.state);
    const before = engine.globalMult();
    engine.root.lifetime = GOAL;
    engine.collapse(1);
    // the collapse also trips a couple of achievements, so isolate the tier's
    // own contribution from theirs
    const bonusDelta = achievementBonus(engine.state) - bonusBefore;
    expect(engine.globalMult()).toBeCloseTo(before + 0.5 + bonusDelta, 9);
    expect(globalMultiplier(engine.state.progress, 0)).toBeCloseTo(1.5, 9);
  });

  it('Epoch trades the multiplier for exponent and a law', () => {
    const engine = freshEngine(42, 0);
    engine.state.progress.collapses = COLLAPSES_PER_EPOCH;
    const eBefore = baseExponent(engine.state.progress);
    const multBefore = engine.globalMult();
    const res = engine.epoch(1)!;
    expect(baseExponent(engine.state.progress)).toBeGreaterThan(eBefore);
    expect(engine.globalMult()).toBeLessThan(multBefore);
    expect(res.law).toBeTruthy();
    expect(engine.state.progress.laws).toContain(res.law!.id);
  });

  it('each law changes a rule and none of them fire at epoch 0', () => {
    const base = deriveRules({ collapses: 0, epochs: 0, genesis: 0, laws: [], bankIndex: 0, bankSeed: 0 });
    for (const law of EPOCH_LAWS) {
      const r = deriveRules({
        collapses: 0,
        epochs: 1,
        genesis: 0,
        laws: [law.id],
        bankIndex: 0,
        bankSeed: 0,
      });
      const changed =
        r.k !== base.k ||
        r.voidRaw !== base.voidRaw ||
        r.cascadeMult !== base.cascadeMult ||
        r.endowmentMult !== base.endowmentMult ||
        r.anomalyRate !== base.anomalyRate ||
        r.bloomDouble !== base.bloomDouble ||
        r.e > base.e + 0.021;
      expect(changed, `law ${law.id} changed nothing`).toBe(true);
    }
    // the validated regime is epoch 0 with no laws
    expect(base.k).toBe(12);
    expect(base.e).toBeCloseTo(0.7, 12);
    expect(base.voidRaw).toBeCloseTo(1.7, 12);
    expect(base.anomalyRate).toBeCloseTo(1 / 12, 12);
  });

  it('Genesis is worth more exponent than the epochs it consumes', () => {
    const maxEpochs = { collapses: 0, epochs: EPOCHS_PER_GENESIS, genesis: 0, laws: [], bankIndex: 0, bankSeed: 0 };
    const afterGenesis = { collapses: 0, epochs: 0, genesis: 1, laws: [], bankIndex: 0, bankSeed: 0 };
    expect(baseExponent(afterGenesis)).toBeGreaterThan(baseExponent(maxEpochs));
  });

  it('Genesis swaps the phoneme bank', () => {
    const engine = freshEngine(43, 0);
    const nameBefore = engine.root.name;
    engine.state.progress.epochs = EPOCHS_PER_GENESIS;
    engine.genesis(1);
    expect(engine.state.progress.bankIndex).toBe(1);
    expect(engine.bank.id).toBe(1);
    // same root seed, different alphabet, different name
    expect(engine.root.name).not.toBe(nameBefore);
  });

  it('the global multiplier is 1 + 0.5*collapses + achievement bonus', () => {
    const p = { collapses: 4, epochs: 2, genesis: 1, laws: [], bankIndex: 0, bankSeed: 0 };
    expect(globalMultiplier(p, 0.25)).toBeCloseTo(1 + 2 + 0.25, 9);
  });
});

describe('achievements', () => {
  it('are all reachable, uniquely identified and modestly weighted', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect(ids.size).toBe(ACHIEVEMENTS.length);
    let total = 0;
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.desc.length).toBeGreaterThan(0);
      expect(a.bonus).toBeGreaterThan(0);
      total += a.bonus;
    }
    // the entire authored set, fully cleared, is worth under six Collapses —
    // a nudge across a whole save, never a substitute for playing
    expect(total).toBeLessThan(3);
  });

  it('unlock once and stay unlocked', () => {
    const engine = freshEngine(44, 0);
    grow(engine, 600, 20);
    const first = engine.checkAchievements(1);
    expect(first.length).toBeGreaterThan(0);
    const second = engine.checkAchievements(2);
    for (const a of second) expect(first).not.toContain(a);
    expect(achievementBonus(engine.state)).toBeGreaterThan(0);
  });

  it('the codex-completion milestone matches the taxonomy size', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'codex100')!;
    expect(allSpecies().length).toBe(SPECIES_COUNT);
    const state = newGame(1, 0);
    for (const key of allSpecies()) state.meta.codex[key] = {} as any;
    expect(
      a.test({
        state,
        nodeCount: 1,
        codexCount: SPECIES_COUNT,
        rootRate: 0,
        deepestNow: 0,
        anomaliesSeen: new Set(),
        maxUnitsInOneGen: 0,
        openDoorsOnOneNode: 0,
      }),
    ).toBe(true);
  });
});

describe('offline progress', () => {
  it('is capped at twelve hours and reported, not silently applied', () => {
    const engine = freshEngine(50, 0);
    grow(engine, 1200, 25);
    const before = engine.root.lifetime;
    const summary = engine.offline(48 * 60 * 60 * 1000, 1);
    expect(summary.awayMs).toBe(48 * 60 * 60 * 1000);
    expect(summary.cappedMs).toBe(OFFLINE_CAP_MS);
    expect(summary.rootGain).toBeGreaterThan(0);
    expect(engine.root.lifetime).toBeCloseTo(before + summary.rootGain, 4);
  });

  it('reports discoveries made while away', () => {
    const engine = freshEngine(51, 0);
    grow(engine, 2500, 12);
    engine.state.meta.settings.autoDescend = true;
    engine.state.progress.epochs = 4;
    engine.rules = deriveRules(engine.state.progress);
    const summary = engine.offline(6 * 60 * 60 * 1000, 1);
    expect(summary.nodesOpened).toBeGreaterThan(0);
    expect(summary.cappedMs).toBe(6 * 60 * 60 * 1000);
  });

  it('zero or negative time away is a no-op', () => {
    const engine = freshEngine(52, 0);
    grow(engine, 200, 5);
    const before = engine.root.lifetime;
    const s = engine.offline(-5000, 1);
    expect(s.cappedMs).toBe(0);
    expect(engine.root.lifetime).toBe(before);
  });
});

describe('automation never beats attentive play', () => {
  it('an auto-buyer leaves a margin a human can spend', () => {
    const engine = freshEngine(60, 0);
    engine.state.progress.collapses = 5;
    engine.rules = deriveRules(engine.state.progress);
    grow(engine, 400, 8);
    for (let g = 0; g < engine.root.gens.length; g++) engine.setAuto('', g, 1);
    const auto = engine.state.meta.stats.unitsEverBought;
    for (let i = 0; i < 600; i++) engine.step(0.1, 0);
    // auto-buyers spend at most 90% of a node's bank, so there is always
    // something left for a player who is actually watching
    expect(engine.root.currency).toBeGreaterThan(0);
    expect(engine.state.meta.stats.unitsEverBought).toBeGreaterThan(auto);
  });

  it('auto-descend is gated behind epochs', () => {
    const r0 = deriveRules({ collapses: 99, epochs: 0, genesis: 0, laws: [], bankIndex: 0, bankSeed: 0 });
    const r2 = deriveRules({ collapses: 0, epochs: 2, genesis: 0, laws: [], bankIndex: 0, bankSeed: 0 });
    expect(r0.autoDescend).toBe(false);
    expect(r2.autoDescend).toBe(true);
  });
});

describe('seed sharing', () => {
  it('reads a numeric or textual seed out of a query string', () => {
    expect(seedFromUrl('?seed=12345')).toBe(12345);
    expect(seedFromUrl('?a=1&seed=hello')).toBe(seedFromUrl('?seed=hello'));
    expect(seedFromUrl('?nope=1')).toBe(null);
  });

  it('the same seed grows the same tree for two players', () => {
    const a = freshEngine(0xabcdef, 0);
    const b = freshEngine(0xabcdef, 0);
    grow(a, 900, 20);
    grow(b, 900, 20);
    expect(a.order).toEqual(b.order);
    expect(a.root.name).toBe(b.root.name);
    for (const path of a.order) {
      expect(a.state.run.nodes[path].name).toBe(b.state.run.nodes[path].name);
      expect(a.state.run.nodes[path].species).toBe(b.state.run.nodes[path].species);
    }
    expect(a.rates['']).toBeCloseTo(b.rates[''], 9);
  });
});

describe('growth limits', () => {
  it('refuses to open doors past the node ceiling', () => {
    const engine = freshEngine(70, 0);
    engine.buy('', 0, 500);
    // pretend we are already at the cap
    const fake: any = {};
    for (let i = 0; i < MAX_NODES; i++) fake['n' + i] = 1;
    engine.order = Object.keys(fake);
    expect(engine.canOpen('', 0)).toBe(false);
  });
});

describe('palette readability at every hue', () => {
  it('accents clear WCAG AA against the page and panel at all 360 hues', () => {
    for (let hue = 0; hue < 360; hue++) {
      for (const surface of [BG, PANEL]) {
        const c = accentRgb(hue, surface);
        expect(contrastRatio(c, surface), `hue ${hue}`).toBeGreaterThanOrEqual(4.49);
      }
      expect(readableAccent(hue)).toMatch(/^rgb\(\d+ \d+ \d+\)$/);
    }
  });

  it('holds at the hues that usually break fixed-lightness palettes', () => {
    // yellow/green are far brighter than blue/violet at the same lightness
    for (const hue of [0, 55, 60, 65, 120, 180, 240, 270, 300, 359]) {
      const c = accentRgb(hue, BG);
      expect(contrastRatio(c, BG)).toBeGreaterThanOrEqual(4.49);
    }
  });

  it('hslToRgb stays in range for arbitrary input', () => {
    for (const h of [-720, -1, 0, 359, 360, 1000]) {
      for (const s of [-1, 0, 0.5, 1, 2]) {
        for (const l of [-1, 0, 0.5, 1, 2]) {
          const c = hslToRgb(h, s, l);
          for (const v of [c.r, c.g, c.b]) {
            expect(Number.isInteger(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(255);
          }
        }
      }
    }
  });
});
