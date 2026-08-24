import { describe, expect, it } from 'vitest';
import { Stockpile } from '@campaign/Stockpile';
import { Refinery } from '@gameplay/production/Refinery';

/**
 * DESIGN.md: "ownership of the site AND ITS PRODUCTION can flip."
 *
 * The sharpest edge of the Consequence pillar — losing a site hands your refineries, your lit nodes
 * and their output to whoever took it. The inheritance rules themselves are todo (the ramp question
 * is open, see docs/GAPS.md); the Stockpile arithmetic they are built on is tested for real, since
 * a bug there would quietly gain or lose campaign materials.
 */
describe('Stockpile arithmetic', () => {
  const base = { Scrap: 100, Rack: 20, Plate: 5, PyronChrome: 1 };

  it('adds without mutating the original', () => {
    const result = Stockpile.add(base, { Scrap: 50 });
    expect(result.Scrap).toBe(150);
    expect(base.Scrap).toBe(100);
  });

  it('clamps subtraction at zero', () => {
    expect(Stockpile.subtract(base, { Plate: 99 }).Plate).toBe(0);
  });

  it('reports affordability exactly at the boundary', () => {
    expect(Stockpile.canAfford(base, { Scrap: 100 })).toBe(true);
    expect(Stockpile.canAfford(base, { Scrap: 101 })).toBe(false);
  });

  it('reports the shortfall per tier', () => {
    const shortfall = Stockpile.shortfall(base, { Scrap: 150, Plate: 2, PyronChrome: 4 });
    expect(shortfall.Scrap).toBe(50);
    expect(shortfall.Plate).toBe(0);
    expect(shortfall.PyronChrome).toBe(3);
  });

  it('reports an empty shortfall when affordable', () => {
    expect(Stockpile.isEmpty(Stockpile.shortfall(base, { Scrap: 10 }))).toBe(true);
  });
});

describe('Refinery', () => {
  it('never produces Pyron Chrome', () => {
    // "You find it; you never forge it." A refinery that could output chrome would make discovery
    // a resource curve instead of a campaign-level event.
    expect(Refinery.isValidOutput('PyronChrome')).toBe(false);
    expect(Refinery.isValidOutput('Plate')).toBe(true);
  });

  it('stops running when its node goes dark', () => {
    // Production runs on signal. No lit NNN, no production — that dependency is what ties Greed to
    // Dread: the way to get more is to stay lit, and staying lit is what gets you killed.
    const refinery = new Refinery({
      id: 'refinery-1',
      nodeId: 'node-a' as never,
      input: { Scrap: 10, Rack: 0, Plate: 0, PyronChrome: 0 },
      output: { Scrap: 0, Rack: 2, Plate: 0, PyronChrome: 0 },
      cycleSeconds: 5,
      loudness: 4,
    });

    refinery.setNodeLit(true);
    expect(refinery.isRunning).toBe(true);
    refinery.setNodeLit(false);
    expect(refinery.isRunning).toBe(false);
  });
});

describe('ProductionInheritance', () => {
  it.todo('transfers production to the new owner when a site flips');
  it.todo('transfers lit nodes still lit, so the signal keeps working for whoever holds it');
  it.todo('transfers queued output rather than evaporating it');
  it.todo('inherits nothing when the site did not actually flip');
  it.todo('transfers nothing resembling fort geometry, because none was ever stored');
  it.todo('is a pure function of the flip outcome and the site state');
});
