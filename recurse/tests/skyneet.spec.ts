import { describe, expect, it } from 'vitest';
import { decideTrunk, newCampaign, resolveOperation, tickWarfront, trunkUnlocked } from '../src/skyneet/engine/campaign';
import { aimSeconds, fallbackCompetence, machineCompetence } from '../src/skyneet/engine/competence';
import { BUILD_COST, canAfford, finish, startOperation, step } from '../src/skyneet/engine/operation';
import { BIBLE } from '../src/skyneet/engine/lore';
import type { FrameInput } from '../src/skyneet/engine/types';

const idle: FrameInput = {
  ax: 0,
  ay: 0,
  wx: 0,
  wy: 0,
  fire: false,
  place: false,
  interact: false,
  leave: false,
  build: null,
};

describe('competence', () => {
  it('is inverse to lethality on fallback', () => {
    expect(fallbackCompetence(0.92)).toBeCloseTo(0.08);
    expect(fallbackCompetence(0.18)).toBeCloseTo(0.82);
  });

  it('Sancient window snaps neutrino machines to 1 and leaves Nobots alone', () => {
    const walker = {
      id: 1,
      kind: 'walker' as const,
      x: 0,
      y: 0,
      hp: 10,
      maxHp: 10,
      lethality: 0.74,
      neutrino: true,
      vx: 0,
      vy: 0,
      aim: 0,
      tx: 0,
      ty: 0,
      telegraph: 0,
      wander: 0,
      window: 0,
      charge: 0,
    };
    const nobot = { ...walker, kind: 'nobot' as const, neutrino: false, lethality: 0.22 };
    expect(machineCompetence(walker, true, true)).toBe(1);
    expect(machineCompetence(walker, false, true)).toBeCloseTo(0.26);
    expect(machineCompetence(nobot, true, true)).toBe(0.88);
    expect(aimSeconds(1)).toBeLessThan(aimSeconds(0.1));
  });
});

describe('campaign', () => {
  it('generates a deterministic archipelago with a trunk', () => {
    const a = newCampaign(42);
    const b = newCampaign(42);
    expect(Object.keys(a.sites)).toEqual(Object.keys(b.sites));
    expect(a.sites.trunk_0.biome).toBe('trunk');
    expect(a.pipelines.length).toBeGreaterThan(3);
  });

  it('keeps the trunk locked until the campaign has weight', () => {
    const c = newCampaign(7);
    expect(trunkUnlocked(c)).toBe(false);
    c.opsResolved = 5;
    expect(trunkUnlocked(c)).toBe(true);
  });

  it('warfront pressure is driven by lit nodes and is visible', () => {
    const c = newCampaign(3);
    c.sites.cavern_0.lit = true;
    c.sites.cavern_1.lit = true;
    const wf = tickWarfront(c, 0.1);
    expect(wf.litNodes).toBeGreaterThanOrEqual(2);
    expect(wf.note).toContain('Warfront');
    expect(wf.pressure).toBeGreaterThan(0);
  });

  it('cut ending darkens the net; hold claims every hole', () => {
    const c = newCampaign(1);
    c.sites.cavern_0.lit = true;
    decideTrunk(c, 'cut');
    expect(c.ending).toBe('cut');
    expect(c.sites.cavern_0.lit).toBe(false);
    expect(c.stock.scrap).toBe(0);
    const d = newCampaign(2);
    decideTrunk(d, 'hold');
    expect(Object.values(d.sites).every((s) => s.owner === 'neet')).toBe(true);
  });
});

describe('operation', () => {
  it('starts dark, with NNN last in the graph', () => {
    const c = newCampaign(11);
    const op = startOperation(c, 'cavern_0');
    expect(op.nnnLit).toBe(false);
    expect(op.logs[0].line).toContain('[SkyNeet]');
    expect(canAfford(c.stock, 'nnn', op)).toBe(false);
    expect(BUILD_COST.nnn.rack).toBeGreaterThan(0);
  });

  it('steps without throwing and can finish a running drop as abandoned', () => {
    const c = newCampaign(19);
    const op = startOperation(c, 'cavern_0');
    for (let i = 0; i < 20; i++) step(op, c.stock, { ...idle, ax: 1 }, 0.05);
    expect(op.player.hp).toBeGreaterThan(0);
    op.result = 'abandoned';
    const r = finish(op);
    resolveOperation(c, r);
    expect(c.opsResolved).toBe(1);
  });

  it('a dark cavern does not delete Gould in the first seconds', () => {
    for (const seed of [3, 11, 19, 42, 99]) {
      const c = newCampaign(seed);
      const op = startOperation(c, 'cavern_0');
      expect(op.nnnLit).toBe(false);
      for (let i = 0; i < 80; i++) step(op, c.stock, idle, 0.05);
      expect(op.result).toBe('running');
      expect(op.player.hp).toBe(op.player.maxHp);
    }
  });
});

describe('bible', () => {
  it('covers the axiom, NNN, Sancient and both trunk endings', () => {
    const ids = BIBLE.map((a) => a.id);
    for (const id of ['axiom', 'nnn', 'sancient', 'cut', 'hold', 'warfront']) {
      expect(ids).toContain(id);
    }
  });
});
