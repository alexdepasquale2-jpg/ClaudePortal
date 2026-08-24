import { describe, expect, it } from 'vitest';
import { materialFor } from '@core/data/materials/MaterialDefinition';
import { MATERIAL_TIERS } from '@core/types/Vocabulary';
import { effectiveLoudness } from '@gameplay/nodes/NeetNetNode';
import { ChromeShield } from '@gameplay/nodes/ChromeShield';

/**
 * DESIGN.md: Pyron Chrome's ONLY mechanical purpose is to protect a primary NNN — reduced noise
 * signature and extended safe hold time. Not armour, not damage, not production.
 *
 * The signature half is implemented and tested here. The safe-hold half is todo, and is exactly the
 * half that gets forgotten, which is why it has its own named test waiting for it.
 */
describe('Pyron Chrome material', () => {
  it('is not forgeable', () => {
    expect(materialFor('PyronChrome').forgeable).toBe(false);
  });

  it('is the only material that declares NNN protection', () => {
    for (const tier of MATERIAL_TIERS) {
      const material = materialFor(tier);
      if (tier === 'PyronChrome') {
        expect(material.noiseSignatureMultiplier).toBeDefined();
        expect(material.safeHoldExtension).toBeDefined();
      } else {
        expect(material.noiseSignatureMultiplier).toBeUndefined();
        expect(material.safeHoldExtension).toBeUndefined();
      }
    }
  });

  it('reduces rather than eliminates the signature', () => {
    // Chrome buys time on the decision; it must not remove the decision.
    const multiplier = materialFor('PyronChrome').noiseSignatureMultiplier ?? 1;
    expect(multiplier).toBeGreaterThan(0);
    expect(multiplier).toBeLessThan(1);
  });
});

describe('ChromeShield', () => {
  const shield = new ChromeShield({ noiseSignatureMultiplier: 0.35, safeHoldExtension: 12 });

  const node = (overrides: Partial<Parameters<typeof effectiveLoudness>[0]> = {}) => ({
    id: 'node-a' as never,
    position: { x: 0, y: 0, z: 0 },
    planted: true,
    lit: true,
    primary: true,
    chromed: false,
    baseLoudness: 20,
    production: { Scrap: 1, Rack: 0, Plate: 0, PyronChrome: 0 },
    health: 100,
    maxHealth: 100,
    ...overrides,
  });

  it('protects only a primary node', () => {
    expect(shield.canProtect(node({ primary: true }))).toBe(true);
    expect(shield.canProtect(node({ primary: false }))).toBe(false);
  });

  it('refuses to protect an already-chromed node', () => {
    expect(shield.canProtect(node({ chromed: true }))).toBe(false);
  });

  it('reduces the loudness of a lit node', () => {
    expect(shield.shieldedLoudness(node())).toBeCloseTo(7);
  });

  it('leaves a dark node silent, chromed or not', () => {
    // An unlit node makes no noise to reduce. Chrome is not a stealth field.
    expect(shield.shieldedLoudness(node({ lit: false }))).toBe(0);
  });
});

describe('effectiveLoudness', () => {
  const node = {
    id: 'node-a' as never,
    position: { x: 0, y: 0, z: 0 },
    planted: true,
    lit: true,
    primary: true,
    chromed: false,
    baseLoudness: 20,
    production: { Scrap: 1, Rack: 0, Plate: 0, PyronChrome: 0 },
    health: 100,
    maxHealth: 100,
  };

  it('returns zero for an unlit node', () => {
    expect(effectiveLoudness({ ...node, lit: false }, 0.35)).toBe(0);
  });

  it('returns base loudness for a lit, unchromed node', () => {
    expect(effectiveLoudness(node, 0.35)).toBe(20);
  });

  it('applies the multiplier only when chromed', () => {
    expect(effectiveLoudness({ ...node, chromed: true }, 0.35)).toBeCloseTo(7);
  });
});

describe('ChromeShield — safe hold', () => {
  // The second half of chrome's purpose, and the one that gets forgotten.
  it.todo('extends safe hold time by the material-defined extension');
  it.todo('delays Sancient eligibility by exactly the extension');
  it.todo('does not extend safe hold for an unprotected primary');
});
