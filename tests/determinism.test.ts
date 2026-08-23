import { describe, expect, it } from 'vitest';
import { runScript, killScript } from './harness';
import { createWorld, spawnMob } from '../src/sim/world';
import { tick } from '../src/sim/tick';

const logOf = (w: ReturnType<typeof runScript>) => w.log.map(l => `${l.tick}|${l.kind}|${l.text}`).join('\n');

describe('determinism', () => {
  it('same seed + same commands produce an identical combat log', () => {
    const a = runScript(12345, 'warrior', 900, killScript('boar'));
    const b = runScript(12345, 'warrior', 900, killScript('boar'));
    expect(logOf(a)).toBe(logOf(b));
    expect(a.log.length).toBeGreaterThan(10);
  });

  it('a different seed produces a different combat log', () => {
    const a = runScript(1, 'warrior', 900, killScript('boar'));
    const b = runScript(2, 'warrior', 900, killScript('boar'));
    expect(logOf(a)).not.toBe(logOf(b));
  });

  it('the warrior kills a boar and gains experience', () => {
    const w = runScript(777, 'warrior', 1200, killScript('boar'));
    expect(w.log.some(l => l.kind === 'death' && l.text.includes('Mangy Boar'))).toBe(true);
    expect(w.player.xp).toBeGreaterThan(0);
  });

  it('the mage kills a lone boar with fireball', () => {
    const w = createWorld(999, 'mage', 'Tester');
    const p = w.units.get(w.player.unitId)!;
    for (const u of [...w.units.values()]) if (u.kind === 'mob') w.units.delete(u.id);
    const boar = spawnMob(w, 'boar', p.pos.x, p.pos.z - 22);
    for (let t = 0; t < 1200 && !boar.dead; t++) {
      tick(w, [{ t: 'cast', spellId: 'fireball', targetId: boar.id }]);
    }
    expect(boar.dead).toBe(true);
    expect(w.log.some(l => l.text.includes('Fireball'))).toBe(true);
    expect(w.player.xp).toBeGreaterThan(0);
  });
});
