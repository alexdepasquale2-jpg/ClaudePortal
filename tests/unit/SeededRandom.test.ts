import { describe, expect, it } from 'vitest';
import { SeededRandom, hashString } from '@core/utilities/SeededRandom';

/**
 * Written for real rather than todo'd, because determinism is a prerequisite for everything else.
 *
 * ARCHITECTURE.md: a run must be reproducible from (campaignSeed, siteId, runIndex) or
 * SeededGeneration means nothing and no leaderboard claim can ever be checked. If these tests fail,
 * every other guarantee in the project is void.
 */
describe('SeededRandom', () => {
  it('produces an identical sequence for an identical seed', () => {
    const a = new SeededRandom(12345);
    const b = new SeededRandom(12345);
    const left = Array.from({ length: 64 }, () => a.next());
    const right = Array.from({ length: 64 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    expect(Array.from({ length: 16 }, () => a.next())).not.toEqual(
      Array.from({ length: 16 }, () => b.next()),
    );
  });

  it('stays within [0, 1)', () => {
    const rng = new SeededRandom(99);
    for (let i = 0; i < 5000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('resumes an identical stream from a serialised seed', () => {
    // This is what makes a campaign save able to carry a generator's position.
    const original = new SeededRandom(777);
    original.next();
    original.next();

    const resumed = new SeededRandom(original.seed);
    const continued = Array.from({ length: 8 }, () => original.next());
    expect(Array.from({ length: 8 }, () => resumed.next())).toEqual(continued);
  });

  it('derives named streams that are stable and independent', () => {
    // Streams are derived by NAME so adding a new system does not shift every existing stream and
    // silently change every site in the game.
    const layoutA = SeededRandom.derive(42, 'layout');
    const layoutB = SeededRandom.derive(42, 'layout');
    const goliaths = SeededRandom.derive(42, 'goliaths');

    expect(layoutA.next()).toBe(layoutB.next());
    expect(SeededRandom.derive(42, 'layout').next()).not.toBe(goliaths.next());
  });

  it('keeps int() within the requested inclusive bounds', () => {
    const rng = new SeededRandom(5);
    for (let i = 0; i < 2000; i++) {
      const value = rng.int(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('picks and shuffles deterministically', () => {
    const items = ['hauler', 'warden', 'ordnance-frame', 'lattice-crawler'];
    const a = new SeededRandom(2024);
    const b = new SeededRandom(2024);
    expect(a.pick(items)).toBe(b.pick(items));
    expect(a.shuffle([...items])).toEqual(b.shuffle([...items]));
  });

  it('refuses to pick from an empty array rather than returning undefined', () => {
    expect(() => new SeededRandom(1).pick([])).toThrow(/empty array/);
  });

  it('hashes strings deterministically', () => {
    expect(hashString('signal-vault')).toBe(hashString('signal-vault'));
    expect(hashString('signal-vault')).not.toBe(hashString('flooded-cut'));
  });
});
