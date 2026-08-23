import { describe, expect, it } from 'vitest';
import { createWorld, spawnMob } from '../src/sim/world';
import { tick } from '../src/sim/tick';
import { canCast } from '../src/sim/spells';
import { applyAura, hasAura } from '../src/sim/auras';
import { swing } from '../src/sim/combat';
import { MAX_RAGE } from '../src/data/formulas';
import type { World } from '../src/sim/types';

/** Strip the zone down to the player so a wandering spawn cannot join the fight. */
const solo = (w: World) => { for (const u of [...w.units.values()]) if (u.kind !== 'player') w.units.delete(u.id); };

/** If the spell system cannot express both of these, the system is wrong. */
describe('the two class gates', () => {
  it('Overpower is locked until the target dodges, then usable for five seconds', () => {
    const w = createWorld(7, 'warrior', 'Gate');
    const p = w.units.get(w.player.unitId)!;
    solo(w);
    p.level = 6; p.power = MAX_RAGE;
    w.player.knownSpells.push('overpower');
    const boar = spawnMob(w, 'boar', p.pos.x + 2, p.pos.z);
    boar.health = boar.maxHealth = 100000;

    expect(canCast(w, p, 'overpower', boar.id)).toMatch(/not ready/i);

    // Force the dodge branch of the attack table; that is what opens the window.
    let dodged = false;
    for (let i = 0; i < 500 && !dodged; i++) dodged = swing(w, p, boar, 5, 'test') === 'dodge';
    expect(dodged).toBe(true);
    expect(hasAura(p, 'overpower_window')).toBe(true);
    expect(canCast(w, p, 'overpower', boar.id)).toBeNull();

    // The window expires on its own after five seconds of ticks.
    for (let i = 0; i < 120; i++) tick(w, []);
    expect(hasAura(p, 'overpower_window')).toBe(false);
    expect(canCast(w, p, 'overpower', boar.id)).toMatch(/not ready/i);
  });

  it('Polymorph incapacitates, regenerates the target, and breaks on any damage', () => {
    const w = createWorld(11, 'mage', 'Gate');
    const p = w.units.get(w.player.unitId)!;
    solo(w);
    const boar = spawnMob(w, 'boar', p.pos.x + 3, p.pos.z);
    boar.health = 20;

    applyAura(w, p, boar, 'polymorph');
    expect(hasAura(boar, 'polymorph')).toBe(true);

    for (let i = 0; i < 60; i++) tick(w, []);
    expect(boar.health).toBeGreaterThan(20);          // sheep regenerates while CC'd
    expect(hasAura(boar, 'polymorph')).toBe(true);
    expect(boar.inCombat).toBe(false);

    swing(w, p, boar, 12, 'test', { cannotMiss: true });
    expect(hasAura(boar, 'polymorph')).toBe(false);   // any damage breaks it
  });

  it('a warrior generates rage from damage taken and bleeds it off out of combat', () => {
    const w = createWorld(3, 'warrior', 'Gate');
    const p = w.units.get(w.player.unitId)!;
    solo(w);
    const boar = spawnMob(w, 'boar', p.pos.x + 2, p.pos.z);
    expect(p.power).toBe(0);

    for (let i = 0; i < 12; i++) swing(w, boar, p, 8, 'test', { cannotMiss: true });
    const peak = p.power;
    expect(peak).toBeGreaterThan(0);

    w.units.delete(boar.id);
    p.inCombat = false;
    for (let i = 0; i < 40; i++) tick(w, []);
    expect(p.power).toBeLessThan(peak);
  });
});
