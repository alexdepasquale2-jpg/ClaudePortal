import { describe, expect, it } from 'vitest';
import * as F from '../src/data/formulas';

describe('formulas', () => {
  it('armor damage reduction is capped and level-scaled', () => {
    expect(F.armorDR(0, 5)).toBe(0);
    expect(F.armorDR(1e9, 5)).toBeCloseTo(F.ARMOR_DR_CAP, 5);
    expect(F.armorDR(500, 5)).toBeGreaterThan(F.armorDR(500, 20));
  });

  it('grey mobs award no experience and higher-level mobs award more', () => {
    expect(F.xpLevelMod(10, F.greyLevel(10))).toBe(0);
    expect(F.xpLevelMod(10, 12)).toBeGreaterThan(1);
    expect(F.xpLevelMod(10, 10)).toBe(1);
  });

  it('the xp curve is monotonic through the level 1-10 slice', () => {
    // The table ends at 9 -> 10; level 10 is the zone cap, so there is no next entry.
    for (let l = 1; l < 9; l++) expect(F.xpToLevel(l + 1)).toBeGreaterThan(F.xpToLevel(l));
    expect(F.XP_TABLE.length).toBe(9);
  });

  it('stamina past the free points is worth ten health each', () => {
    const a = F.maxHealthFrom(F.STA_FREE_POINTS, 1, 20);
    const b = F.maxHealthFrom(F.STA_FREE_POINTS + 1, 1, 20);
    expect(b - a).toBe(F.HEALTH_PER_STA);
  });
});
