import { describe, expect, it } from 'vitest';
import { createWorld, spawnMob } from '../src/sim/world';
import { rollAttack } from '../src/sim/attackTable';
import type { AttackOutcome } from '../src/sim/types';

describe('attack table', () => {
  it('is a single sequential roll with Classic-shaped frequencies vs an equal-level mob', () => {
    const w = createWorld(42, 'warrior', 'Tester');
    const p = w.units.get(w.player.unitId)!;
    p.level = 5;
    const mob = spawnMob(w, 'kobold', 0, 0);
    const counts: Record<string, number> = {};
    const N = 50000;
    for (let i = 0; i < N; i++) {
      const o: AttackOutcome = rollAttack(w, p, mob);
      counts[o] = (counts[o] ?? 0) + 1;
    }
    const pct = (k: string) => ((counts[k] ?? 0) / N) * 100;
    expect(pct('miss')).toBeGreaterThan(4);
    expect(pct('miss')).toBeLessThan(8);
    expect(pct('dodge')).toBeGreaterThan(0.3);
    expect(pct('dodge')).toBeLessThan(6);
    // No glancing blows: the mob is not 3+ levels above the player.
    expect(counts['glancing'] ?? 0).toBe(0);
    expect(pct('hit')).toBeGreaterThan(70);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(N);
  });

  it('adds glancing blows only against mobs three or more levels above', () => {
    const w = createWorld(42, 'warrior', 'Tester');
    const p = w.units.get(w.player.unitId)!;
    p.level = 4;
    const mob = spawnMob(w, 'kobold_overseer', 0, 0); // level 9
    let glancing = 0;
    for (let i = 0; i < 20000; i++) if (rollAttack(w, p, mob) === 'glancing') glancing++;
    expect(glancing / 20000).toBeGreaterThan(0.2);
  });
});
