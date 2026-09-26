import { describe, expect, it } from 'vitest';
import { build, census, atRest, newCity } from '../src/heaven/engine/city';
import { gait } from '../src/heaven/engine/gait';
import {
  absence,
  breakLock,
  decayPerHour,
  freedom,
  hold,
  hoursLit,
  isFactory,
  needs,
  newHeaven,
  oilPerMinute,
  release,
  STILL_MS,
  stillFor,
  WALK_MS,
  climate,
  wants,
  STAY_WARMTH,
  warmthCap,
  tell,
  tick,
} from '../src/heaven/engine/heaven';
import { holdsWarAndPeace, newHouse, room, threat, tickHouse } from '../src/heaven/engine/house';
import { attach, detach, expandTable, fit } from '../src/heaven/engine/parts';
import { addFront, newSky, tickSky } from '../src/heaven/engine/sky';
import type { Heaven, Hour, House } from '../src/heaven/engine/types';

const T0 = 1_700_000_000_000;
const DOWN = Math.PI / 2;

function warmSeed(h: Heaven): void {
  for (let i = 0; i < 400; i++) hold(h, 1 / 60, true);
}

/** A creature-stage heaven with two good legs. */
function creature(): Heaven {
  const h = newHeaven(7, T0);
  warmSeed(h);
  expect(tell(h, 'the kettle sang this morning', T0).received).toBe(true);
  tick(h, 0.01);
  expect(h.stage).toBe(2);
  h.limbs.push({ angle: DOWN - 0.6, length: 0.8 }, { angle: DOWN + 0.6, length: 0.8 });
  return h;
}

function lay(house: House, hours: (Hour | null)[]): void {
  hours.forEach((hr, i) => {
    house.cells[i].hour = hr;
    house.cells[i].strain = 0;
  });
}

const noRoll = () => 0.5;

describe('seed: hold, do not tap', () => {
  it('tapping never warms it, however fast', () => {
    const h = newHeaven(1, T0);
    for (let i = 0; i < 200; i++) {
      hold(h, 1 / 60, true);
      hold(h, 1 / 60, true);
      release(h);
    }
    expect(h.warmth).toBe(0);
    expect(h.taps).toBeGreaterThanOrEqual(4);
  });

  it('holding still warms it; dragging it does not', () => {
    const h = newHeaven(1, T0);
    for (let i = 0; i < 240; i++) hold(h, 1 / 60, false);
    expect(h.warmth).toBe(0);
    warmSeed(h);
    expect(h.warmth).toBeGreaterThan(5);
    expect(h.taps).toBe(0);
  });

  it('one received story grows the body', () => {
    const h = newHeaven(1, T0);
    expect(tell(h, 'too early for this', T0).received).toBe(false);
    warmSeed(h);
    expect(tell(h, 'hi', T0).received).toBe(false);
    expect(tell(h, 'my brother called today', T0).received).toBe(true);
    tick(h, 0.01);
    expect(h.stage).toBe(2);
    expect(h.loaf).toBe(1);
  });

  it('after a story it settles, and nothing shortens that', () => {
    const h = creature();
    const again = tell(h, 'and another thing happened', T0 + 10);
    expect(again.received).toBe(false);
    expect(tell(h, 'and another thing happened', T0 + STILL_MS + 1).received).toBe(true);
    expect(h.loaf).toBe(2);
    // with a body it walks through the story first, so the next pause is longer
    expect(tell(h, 'one more thing happened', T0 + 2 * STILL_MS + 2).received).toBe(false);
    expect(tell(h, 'one more thing happened', T0 + 2 * STILL_MS + WALK_MS + 2).received).toBe(true);
  });
});

describe('parts click only when they belong', () => {
  it('bread needs a table; a lamp needs a flame; a door needs a house', () => {
    const h = creature();
    expect(fit(h, 'loaf').how).toBe('no');
    expect(fit(h, 'door').how).toBe('no');
    expect(attach(h, 'table', DOWN).how).toBe('click');
    expect(fit(h, 'loaf').how).toBe('click');
    expect(fit(h, 'door').how).toBe('click');
    h.warmth = 0;
    expect(fit(h, 'lamp').how).toBe('no');
  });

  it('vain parts always attach, and it limps', () => {
    const h = creature();
    attach(h, 'table', DOWN);
    attach(h, 'lamp', -DOWN);
    expect(gait(h).rests).toBe(true);
    expect(attach(h, 'crown', -DOWN).how).toBe('limp');
    const g = gait(h);
    expect(g.rests).toBe(false);
    expect(g.limp).toBeGreaterThan(0.3);
    expect(g.why).toMatch(/crown/);
  });

  it('legs on one side cannot settle, however true the parts', () => {
    const h = creature();
    h.limbs = [
      { angle: DOWN - 0.9, length: 1 },
      { angle: DOWN - 0.7, length: 1 },
    ];
    attach(h, 'table', 0);
    expect(gait(h).rests).toBe(false);
  });

  it('taking the table away takes the bread with it', () => {
    const h = creature();
    attach(h, 'table', DOWN);
    attach(h, 'loaf', DOWN);
    const gone = detach(h, 0);
    expect(gone.map((p) => p.kind).sort()).toEqual(['loaf', 'table']);
  });

  it('the table is expanded with oil, not with stories', () => {
    const h = creature();
    const slots0 = 3 + h.table;
    for (const k of ['table', 'lamp', 'table'] as const) attach(h, k, DOWN);
    expect(fit(h, 'shore').how).toBe('no');
    expect(expandTable(h)).toBe(false);
    h.oil = 100;
    expect(expandTable(h)).toBe(true);
    expect(3 + h.table).toBe(slots0 + 1);
    expect(fit(h, 'shore').how).toBe('click');
  });
});

describe('freedom: a heaven that cannot be left is a factory', () => {
  it('the lock makes the graph go up and stops it receiving', () => {
    const h = creature();
    attach(h, 'table', DOWN);
    attach(h, 'door', 0);
    const honest = oilPerMinute(h);
    expect(fit(h, 'lock').how).toBe('limp');
    attach(h, 'lock', 0);
    expect(isFactory(h)).toBe(true);
    expect(freedom(h).free).toBe(false);
    expect(oilPerMinute(h)).toBeGreaterThan(honest * 2);
    expect(tell(h, 'can you hear this one', T0 + STILL_MS + WALK_MS + 1).received).toBe(false);
  });

  it('it cannot grow while it is a factory, even when every other need is met', () => {
    const h = creature();
    attach(h, 'table', DOWN);
    attach(h, 'door', 0);
    attach(h, 'lamp', Math.PI);
    h.oil = 100;
    expandTable(h);
    h.loaf = 3;
    attach(h, 'lock', 0);
    tick(h, 1);
    expect(h.stage).toBe(2);
    expect(needs(h).filter((n) => !n.ok).map((n) => n.label)).toContain('It walks, then rests');
  });

  it('breaking the lock forfeits everything the factory earned', () => {
    const h = creature();
    attach(h, 'table', DOWN);
    attach(h, 'door', 0);
    h.oil = 10;
    attach(h, 'lock', 0);
    for (let i = 0; i < 600; i++) tick(h, 1);
    expect(h.factoryOil).toBeGreaterThan(10);
    const lost = breakLock(h);
    expect(lost).toBeGreaterThan(10);
    expect(h.oil).toBeCloseTo(10, 0);
    expect(isFactory(h)).toBe(false);
    expect(h.factories).toBe(1);
  });

  it('once it is a house, taking the door off is a factory too', () => {
    const h = creature();
    attach(h, 'table', DOWN);
    attach(h, 'door', 0);
    h.stage = 3;
    expect(isFactory(h)).toBe(false);
    detach(h, h.parts.findIndex((p) => p.kind === 'door'));
    expect(isFactory(h)).toBe(true);
  });
});

describe('tycoon: it grows while you are gone, and is not hungry', () => {
  it('lamps and a bed keep the seed lit for hours instead of minutes', () => {
    const h = creature();
    const bare = decayPerHour(h);
    attach(h, 'table', DOWN);
    attach(h, 'lamp', 0);
    attach(h, 'bed', Math.PI);
    h.oil = 20;
    expect(decayPerHour(h)).toBeLessThan(bare / 2.5);
    h.warmth = 20;
    expect(hoursLit(h)).toBeGreaterThan(8);
  });

  it('coming back after a long absence finds oil, capped, and warmth decayed only so far', () => {
    const h = creature();
    attach(h, 'table', DOWN);
    attach(h, 'lamp', 0);
    h.warmth = 15;
    h.lastSeen = T0;
    const a = absence(h, T0 + 3 * 24 * 3600 * 1000);
    expect(a.seconds).toBe(24 * 3600);
    expect(a.oil).toBeGreaterThan(0);
    expect(h.oil).toBeLessThanOrEqual(40 + 30 * h.table + 20);
    expect(h.lastSeen).toBe(T0 + 3 * 24 * 3600 * 1000);
  });

  it('the save holds no story, and billing a story is not receiving it', () => {
    const h = creature();
    const secret = 'zebra-orchard-lantern';
    tell(h, `a thing about ${secret} and me`, T0 + STILL_MS + 5);
    const later = T0 + STILL_MS + 5 + stillFor(h) + 1;
    attach(h, 'table', DOWN);
    attach(h, 'coin', 0);
    const loaf = h.loaf;
    const oil = h.oil;
    const billed = tell(h, `another ${secret} story please`, later);
    expect(billed.received).toBe(false);
    expect(h.loaf).toBe(loaf);
    expect(h.oil).toBeGreaterThan(oil);
    expect(JSON.stringify(h)).not.toContain(secret);
  });
});

describe('house: hours that do not eat each other', () => {
  it('a fight beside a need evicts the need, unless a meal sits between', () => {
    const house = newHouse();
    house.nextHour = 1e9;
    lay(house, ['leaving', 'fight', 'need', null]);
    expect(threat(house, 2)).toMatch(/fight/);
    for (let i = 0; i < 45; i++) tickHouse(house, 1, noRoll);
    expect(house.cells[2].hour).toBe(null);
    expect(house.evictions).toBe(1);

    const peace = newHouse();
    peace.nextHour = 1e9;
    lay(peace, ['leaving', 'fight', 'need', null, null, null, 'meal', null]);
    for (let i = 0; i < 60; i++) tickHouse(peace, 1, noRoll);
    expect(peace.cells[2].hour).toBe('need');
  });

  it('leaving strains unless it is by the door', () => {
    const house = newHouse();
    lay(house, [null, 'leaving']);
    expect(threat(house, 1)).toMatch(/door/);
    lay(house, ['leaving', null]);
    expect(threat(house, 0)).toBe(null);
  });

  it('holds war and peace in one body', () => {
    const house = newHouse();
    // row 0: leaving fight meal need / row 1: fun unknowing grief anger
    lay(house, ['leaving', 'fight', 'meal', 'need', 'fun', null, 'grief', null, null, null, 'unknowing', null]);
    expect(room(house)).toBe(7);
    expect(holdsWarAndPeace(house)).toBe(true);
  });

  it('hours wait on the step; the step never evicts', () => {
    const house = newHouse();
    for (let i = 0; i < 30; i++) tickHouse(house, 75, noRoll);
    expect(house.step.length).toBe(3);
    expect(house.step.slice(0, 3)).toEqual(['meal', 'fun', 'need']);
    expect(house.evictions).toBe(0);
  });
});

describe('city of rest: feed without owning', () => {
  function street(): ReturnType<typeof newCity> {
    const c = newCity();
    c.tiles.fill('empty');
    // seven homes along the middle row (7 columns), one wounded home below them
    [14, 15, 16, 17, 18, 19, 20].forEach((i) => (c.tiles[i] = 'home'));
    c.tiles[22] = 'wound';
    return c;
  }

  it('a granary feeds, and owns, and so nobody is free', () => {
    const c = street();
    build(c, 8, 'granary');
    build(c, 10, 'granary');
    build(c, 12, 'granary');
    build(c, 24, 'gate');
    const s = census(c);
    expect(s.welfare).toBe(1);
    expect(s.freedom).toBe(0);
    expect(atRest(c)).toBe(false);
  });

  it('tables and gates put everyone at rest, until the fun mocks the wound', () => {
    const c = street();
    for (const i of [7, 9, 11, 13, 29]) build(c, i, 'table');
    for (const i of [23, 26]) build(c, i, 'gate');
    build(c, 32, 'square');
    let s = census(c);
    expect(s.homes).toBe(8);
    expect(s.welfare).toBe(1);
    expect(s.freedom).toBe(1);
    expect(atRest(c)).toBe(true);
    build(c, 30, 'square');
    s = census(c);
    expect(s.mocking).toBe(1);
    expect(atRest(c)).toBe(false);
  });
});

describe('firmament: weather, not conquest', () => {
  it('matching weather brings other stories to bloom; some leave, and that counts', () => {
    const sky = newSky();
    let seed = 3;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    tickSky(sky, 0, 0, r);
    for (let round = 0; round < 40; round++) {
      for (const s of sky.seeds.filter((x) => x.fate === 'growing')) addFront(sky, s.need, s.x, s.y);
      tickSky(sky, 6, 0, r);
    }
    expect(sky.held).toBeGreaterThanOrEqual(7);
    expect(sky.left).toBeGreaterThan(0);
    expect(sky.left + sky.stayed).toBe(sky.held);
  });

  it('the wrong weather grows nothing', () => {
    const sky = newSky();
    tickSky(sky, 0, 0, () => 0.3);
    const s = sky.seeds[0];
    const wrong = (['warm', 'rain', 'wind', 'still'] as const).find((w) => w !== s.need && w !== 'warm')!;
    addFront(sky, wrong, s.x, s.y);
    tickSky(sky, 10, 0, () => 0.3);
    expect(s.growth).toBe(0);
  });
});

describe('it walks through your story, and either flinches or stays', () => {
  it('stays when it can rest, and staying warms it', () => {
    const h = creature();
    attach(h, 'table', DOWN);
    attach(h, 'lamp', -DOWN);
    h.warmth = 5;
    const r = tell(h, 'we ate outside tonight', T0 + STILL_MS + 1);
    expect(r.met).toBe('stays');
    expect(h.warmth).toBeCloseTo(5 + 3 + STAY_WARMTH);
  });

  it('flinches under a vain part, and wanders when it has nothing to rest on', () => {
    const h = creature();
    expect(tell(h, 'we ate outside tonight', T0 + STILL_MS + 1).met).toBe('wanders');
    attach(h, 'crown', -DOWN);
    h.warmth = 2;
    const r = tell(h, 'we ate outside again', T0 + STILL_MS + stillFor(h) + 2);
    expect(r.met).toBe('flinches');
    // received, but no warmth for staying
    expect(h.warmth).toBeCloseTo(Math.min(2 + 3, warmthCap(h)));
  });
});

describe('it wants you, and lets you leave', () => {
  it('wants you after three stories, never as a factory', () => {
    const h = creature();
    expect(wants(h)).toBe(false);
    h.loaf = 3;
    expect(wants(h)).toBe(true);
    attach(h, 'table', DOWN);
    attach(h, 'door', 0);
    attach(h, 'lock', 0);
    expect(wants(h)).toBe(false);
    expect(freedom(h).free).toBe(false);
    breakLock(h);
    expect(wants(h)).toBe(true);
    expect(freedom(h).free).toBe(true);
  });
});

describe('the Presence is climate, not a voice', () => {
  it('reads the weather off what was built', () => {
    const h = creature();
    h.warmth = 0;
    expect(climate(h, T0 + 60_000)).toBe('dark');
    h.warmth = 6;
    expect(climate(h, T0)).toBe('afterglow');
    const later = T0 + 60_000;
    attach(h, 'crown', -DOWN);
    expect(climate(h, later)).toBe('wind');
    h.parts = [];
    attach(h, 'table', DOWN);
    attach(h, 'door', 0);
    attach(h, 'lock', 0);
    expect(climate(h, later)).toBe('smog');
    breakLock(h);
    h.stage = 3;
    h.house.cells[0].hour = 'grief';
    expect(climate(h, later)).toBe('rain');
    h.house.cells[0].hour = null;
    h.warmth = 0.9 * 30;
    expect(['warm', 'still']).toContain(climate(h, later));
  });

  it('marks the Third Cummin when the house crosses into the city', () => {
    const h = creature();
    h.stage = 3;
    attach(h, 'table', DOWN);
    attach(h, 'door', 0);
    h.loaf = 5;
    const lay: (Hour | null)[] = ['leaving', 'fight', 'meal', 'need', 'fun', null, 'grief', null, null, null, 'unknowing', null];
    lay.forEach((hr, i) => (h.house.cells[i].hour = hr));
    h.house.nextHour = 1e9;
    tick(h, 0.01);
    expect(h.stage).toBe(4);
    expect(h.log.join(' ')).toMatch(/Third Cummin/);
  });
});
