import { describe, expect, it } from 'vitest';
import { composeReply, quoteOf } from '../src/engine/reply';
import {
  MAX_ON,
  MemoryStore,
  SAVE_KEY,
  arrivalLines,
  currentAsk,
  deleteAll,
  forgetName,
  freshSave,
  give,
  isNarrow,
  leaveVisit,
  loadSave,
  openVisit,
  placePart,
  posture,
  removePart,
  settle,
  settleDelay,
  writeSave,
} from '../src/engine/state';
import { ASKS, LINES, VERSES } from '../src/engine/voice';
import { inferWeather } from '../src/engine/weather';

const DAY = 86_400_000;
const T0 = new Date(2026, 8, 20, 22, 0).getTime();

describe('weather', () => {
  it('tests anger first, so the charge is not refiled as love', () => {
    expect(inferWeather('If you loved me you would have stopped it')).toBe('anger');
  });
  it('reads each weather', () => {
    expect(inferWeather('the bread at supper')).toBe('meal');
    expect(inferWeather('Jonah in the belly, waiting')).toBe('dark');
    expect(inferWeather('he called me by my name')).toBe('name');
    expect(inferWeather('morning came')).toBe('light');
    expect(inferWeather('she said goodbye and was gone')).toBe('leaving');
    expect(inferWeather('I stayed. I wanted to be seen still here.')).toBe('love');
    expect(inferWeather('idk')).toBe('notKnowing');
    expect(inferWeather('')).toBe('notKnowing');
    expect(inferWeather('   ')).toBe('notKnowing');
    expect(inferWeather('a moth on the sill')).toBe('notKnowing');
  });
  it('matches whole words only', () => {
    expect(inferWeather('a grant for the great hall')).toBe('notKnowing');
    expect(inferWeather('I don’t know')).toBe('notKnowing');
  });
});

describe('the reply', () => {
  it('quotes at most twelve words, in order, untouched', () => {
    const q = quoteOf('one two three four five six seven eight nine ten elevn twelve thirteen');
    expect(q.split(' ')).toHaveLength(12);
    expect(q).toContain('elevn');
    expect(quoteOf('')).toBe("I don't know");
  });
  it('gives the nothing-reply to empty and idk', () => {
    for (const t of ['', 'idk', "I don't know"]) {
      const r = composeReply(t);
      expect(r.kind).toBe('nothing');
      expect(r.feeling).toBe('unsure');
      expect(r.verse?.ref).toBe('John 21:12');
      expect(r.question).toBe('Are you hungry, or just tired?');
    }
  });
  it('does not argue with the charge, and offers speak and stay', () => {
    const r = composeReply('If you loved me you would have stopped it');
    expect(r.kind).toBe('lovedStopped');
    expect(r.line).toBe('I heard the love under the charge. I will not argue.');
    expect(r.feeling).toBe('angry');
    expect(r.verse?.ref).toBe('Psalm 22:1');
    expect(r.question).toBeNull();
    expect(r.speakStay).toBe(true);
  });
  it('keeps the dark and the waiting', () => {
    const r = composeReply('Jonah waited in the dark');
    expect(r.kind).toBe('darkWaiting');
    expect(r.verse?.ref).toBe('Jonah 2:1');
    expect(r.question).toBe('What did the waiting sound like?');
  });
  it('lets the supper be a goodbye', () => {
    const r = composeReply('The last supper felt like goodbye');
    expect(r.kind).toBe('supperGoodbye');
    expect(r.feeling).toBe('grieving');
    expect(r.verse?.ref).toBe('Luke 24:30');
  });
  it('sees the wanting', () => {
    const r = composeReply('I wanted to be seen still here');
    expect(r.kind).toBe('stillHere');
    expect(r.line).toBe('The wanting is not small. Stay.');
    expect(r.verse?.ref).toBe('Luke 24:29');
  });
  it('does not call not-knowing faking, and owes one small story', () => {
    const r = composeReply('this feels fake, I never read it');
    expect(r.kind).toBe('fake');
    expect(r.verse?.ref).toBe('1 Kings 19:12');
    expect(r.owesSmallStory).toBe(true);
  });
  it('maps weather to feeling otherwise, with no verse when nothing echoes', () => {
    expect(composeReply('we broke bread by the lake together').feeling).toBe('glad');
    expect(composeReply('the long night in the garden again').verse).toBeNull();
    expect(composeReply('the light came into the room slowly').verse?.ref).toBe('Genesis 1:3');
  });
  it('never says you should, never exclaims', () => {
    const samples = ['', 'idk', 'If you loved me you would have stopped it', 'bread', 'fake', 'dark waiting', 'still here', 'a leaving at dawn', 'my name was called'];
    for (const t of samples) {
      const r = composeReply(t);
      const all = [r.line, r.question, r.verse?.text].join(' ');
      expect(all).not.toMatch(/you should|!|as an ai/i);
    }
  });
  it('only uses verses from the list', () => {
    const refs = new Set(Object.values(VERSES).map((v) => v.ref));
    for (const t of ['', 'bread', 'light', 'name was', 'love', 'goodbye', 'fake', 'dark waiting', 'if you loved me stop']) {
      const v = composeReply(t).verse;
      if (v) expect(refs.has(v.ref)).toBe(true);
    }
  });
});

function firstLife() {
  const s = freshSave();
  const v = openVisit(s, T0);
  return { s, v };
}

describe('what appears when', () => {
  it('first open: first arrival, the first ask, no walk, no rim', () => {
    const { s, v } = firstLife();
    expect(v.kind).toBe('first');
    expect(v.canWalk).toBe(false);
    expect(v.askName).toBe(true);
    expect(arrivalLines(s, v)[0]).toBe(LINES.firstArrival);
    expect(currentAsk(v)).toBe(ASKS[0]);
    expect(s.rim).toEqual([]);
  });

  it('an empty story still becomes a seed, and only then door and loaf', () => {
    const { s, v } = firstLife();
    const seed = give(s, v, '', T0 + 1000);
    expect(s.seeds).toHaveLength(1);
    expect(seed.reply.kind).toBe('nothing');
    expect(seed.ask).toBe(ASKS[0]);
    expect(s.rim).toEqual(['door', 'loaf']);
  });

  it('next open: walks; lamp, table, shore join only if the first story had words and settled', () => {
    const { s, v } = firstLife();
    const seed = give(s, v, 'bread by the shore', T0);
    settle(s, seed);
    leaveVisit(s, T0 + 5000);
    const v2 = openVisit(s, T0 + DAY);
    expect(v2.kind).toBe('nextDay');
    expect(v2.canWalk).toBe(true);
    expect(arrivalLines(s, v2)).toContain(LINES.nextDay);
    expect(s.rim).toEqual(['door', 'loaf', 'lamp', 'table', 'shore']);
    expect(v2.askName).toBe(false);
  });

  it('an empty first story does not bring the rest of the rim', () => {
    const { s, v } = firstLife();
    settle(s, give(s, v, '', T0));
    openVisit(s, T0 + DAY);
    expect(s.rim).toEqual(['door', 'loaf']);
  });

  it('ornament comes after placing and removing another part, or on the third open', () => {
    const { s, v } = firstLife();
    settle(s, give(s, v, 'bread', T0));
    openVisit(s, T0 + DAY);
    expect(s.rim).not.toContain('ornament');
    expect(placePart(s, 'loaf', 0, 0.3)).toBe(true);
    removePart(s, 'loaf');
    expect(s.rim).toContain('ornament');

    const b = firstLife();
    settle(b.s, give(b.s, b.v, 'bread', T0));
    openVisit(b.s, T0 + DAY);
    openVisit(b.s, T0 + 2 * DAY);
    expect(b.s.rim).toContain('ornament');
  });

  it('asks walk the list, then cycle, never shuffled', () => {
    const s = freshSave();
    for (let i = 0; i < ASKS.length + 2; i++) {
      const v = openVisit(s, T0 + i * 1000);
      v.continuation = null;
      expect(currentAsk(v)).toBe(ASKS[i % ASKS.length]);
      give(s, v, 'x', T0 + i * 1000);
    }
  });
});

describe('parts and posture', () => {
  function withRim() {
    const { s, v } = firstLife();
    settle(s, give(s, v, 'bread', T0));
    openVisit(s, T0 + DAY);
    openVisit(s, T0 + DAY + 1);
    return s;
  }

  it('at most three stick; a fourth returns', () => {
    const s = withRim();
    expect(placePart(s, 'door', 0, 0.2)).toBe(true);
    expect(placePart(s, 'loaf', 1, 0.2)).toBe(true);
    expect(placePart(s, 'lamp', 2, 0.2)).toBe(true);
    expect(placePart(s, 'table', 3, 0.2)).toBe(false);
    expect(s.on).toHaveLength(MAX_ON);
  });

  it('hitched with the ornament on, even with the lamp steady', () => {
    const s = withRim();
    placePart(s, 'lamp', 0, 0.2);
    placePart(s, 'ornament', 1, 0.2);
    expect(posture(s, null).hitched).toBe(true);
    removePart(s, 'ornament');
    expect(posture(s, null).hitched).toBe(false);
  });

  it('rests with two weathers, door on, ornament off', () => {
    const s = withRim();
    const v = openVisit(s, T0 + 3 * DAY);
    give(s, v, 'the dark', T0 + 3 * DAY);
    placePart(s, 'door', 0, 0.2);
    expect(posture(s, v).resting).toBe(true);
    placePart(s, 'ornament', 1, 0.2);
    expect(posture(s, v).resting).toBe(false);
  });

  it('narrows when the last three share a weather, widens after a different one settles', () => {
    const s = freshSave();
    for (let i = 0; i < 3; i++) {
      const v = openVisit(s, T0 + i);
      settle(s, give(s, v, 'bread', T0 + i));
    }
    expect(isNarrow(s)).toBe(true);
    expect(s.narrow).toBe(true);
    const v = openVisit(s, T0 + 10);
    const seed = give(s, v, 'light', T0 + 10);
    expect(s.narrow).toBe(true);
    settle(s, seed);
    expect(s.narrow).toBe(false);
  });

  it('thins each new day without the door, recovers at once when it returns', () => {
    const s = withRim();
    openVisit(s, T0 + 3 * DAY);
    openVisit(s, T0 + 5 * DAY);
    expect(s.thin).toBeGreaterThanOrEqual(3);
    expect(posture(s, null).thin).toBe(s.thin);
    placePart(s, 'door', 0, 0.2);
    expect(posture(s, null).thin).toBe(0);
    expect(s.seeds.length).toBeGreaterThan(0);
  });

  it('warm on a return with the door on and a seed', () => {
    const s = withRim();
    placePart(s, 'door', 0, 0.2);
    const v = openVisit(s, T0 + 3 * DAY);
    expect(posture(s, v).warm).toBe(true);
    expect(v.carried).toBe(true);
  });

  it('long absence with the door on: cooler, not thin; shore makes it gentler', () => {
    const s = withRim();
    placePart(s, 'door', 0, 0.2);
    const v = openVisit(s, T0 + 20 * DAY);
    expect(v.kind).toBe('long');
    expect(arrivalLines(s, v)).toContain(LINES.longAbsence);
    expect(v.cool).toBe(1);
    expect(posture(s, v).thin).toBe(0);
    placePart(s, 'shore', 1, 0.2);
    const v2 = openVisit(s, T0 + 40 * DAY);
    expect(v2.cool).toBeLessThan(1);
  });

  it('ornament left on makes the next first walk restless; lingering too, unless the lamp is on', () => {
    const s = withRim();
    placePart(s, 'ornament', 0, 0.2);
    leaveVisit(s, T0 + 3 * DAY);
    expect(openVisit(s, T0 + 4 * DAY).restlessFirstWalk).toBe(true);
    removePart(s, 'ornament');
    s.lingered = true;
    leaveVisit(s, T0 + 4 * DAY);
    expect(openVisit(s, T0 + 5 * DAY).restlessFirstWalk).toBe(true);
    placePart(s, 'lamp', 0, 0.2);
    s.lingered = true;
    leaveVisit(s, T0 + 5 * DAY);
    expect(openVisit(s, T0 + 6 * DAY).restlessFirstWalk).toBe(false);
  });

  it('loaf and a meal story with the table settle sooner', () => {
    const s = withRim();
    const v = openVisit(s, T0 + 3 * DAY);
    const seed = give(s, v, 'bread', T0 + 3 * DAY);
    const base = settleDelay(s, seed);
    placePart(s, 'loaf', 0, 0.2);
    const loaf = settleDelay(s, seed);
    placePart(s, 'table', 1, 0.2);
    expect(loaf).toBeLessThan(base);
    expect(settleDelay(s, seed)).toBeLessThan(loaf);
  });
});

describe('continuation and the third warmth', () => {
  it('a day-old seed replaces the new ask; the late warmth needs the door', () => {
    const { s, v } = firstLife();
    const first = give(s, v, 'the whale and the waiting', T0);
    settle(s, first);
    const v2 = openVisit(s, T0 + DAY);
    expect(v2.continuation?.id).toBe(first.id);
    expect(currentAsk(v2)).toBe(LINES.continuation);
    const cursor = s.askCursor;
    const next = give(s, v2, 'and then the shore', T0 + DAY);
    expect(next.continues).toBe(first.id);
    expect(s.askCursor).toBe(cursor);
    expect(settle(s, next)).toBe(false);

    const v3 = openVisit(s, T0 + 2 * DAY);
    placePart(s, 'door', 0, 0.2);
    const third = give(s, v3, 'and after', T0 + 2 * DAY);
    expect(settle(s, third)).toBe(true);
  });

  it('setting aside shows the next fresh ask and keeps the old seed', () => {
    const { s, v } = firstLife();
    give(s, v, 'bread', T0);
    const v2 = openVisit(s, T0 + DAY);
    v2.setAside = true;
    expect(currentAsk(v2)).toBe(ASKS[1]);
    const seed = give(s, v2, 'light', T0 + DAY);
    expect(seed.continues).toBeNull();
    expect(s.seeds).toHaveLength(2);
  });

  it('a same-day seed is not a continuation', () => {
    const { s, v } = firstLife();
    give(s, v, 'bread', T0);
    expect(openVisit(s, T0 + 60_000).continuation).toBeNull();
  });
});

describe('memory', () => {
  it('stores nothing before the gate', () => {
    const store = new MemoryStore();
    expect(store.get(SAVE_KEY)).toBeNull();
    expect(loadSave(store).opens).toBe(0);
  });

  it('round-trips, and delete returns a first life', () => {
    const store = new MemoryStore();
    const { s, v } = firstLife();
    s.name = 'Ruth';
    give(s, v, 'bread', T0);
    writeSave(store, s);
    expect(loadSave(store).seeds[0]!.text).toBe('bread');
    const fresh = deleteAll(store);
    expect(fresh.seeds).toEqual([]);
    expect(store.get(SAVE_KEY)).toBeNull();
    expect(openVisit(fresh, T0 + DAY).kind).toBe('first');
  });

  it('forgetting the name lets the field return once', () => {
    const { s } = firstLife();
    s.name = 'Ruth';
    forgetName(s);
    expect(openVisit(s, T0 + DAY).askName).toBe(true);
    expect(openVisit(s, T0 + 2 * DAY).askName).toBe(false);
  });

  it('never speaks a name it was not given', () => {
    const { s, v } = firstLife();
    give(s, v, '', T0);
    const v2 = openVisit(s, T0 + DAY);
    expect(arrivalLines(s, v2).join(' ')).not.toMatch(/undefined|null/);
    s.name = 'Ruth';
    expect(arrivalLines(s, openVisit(s, T0 + 2 * DAY))[0]).toBe('Ruth.');
  });

  it('owes the one small story only next time', () => {
    const { s, v } = firstLife();
    give(s, v, 'this feels fake', T0);
    const v2 = openVisit(s, T0 + DAY);
    expect(arrivalLines(s, v2)).toContain(LINES.smallStory);
    const v3 = openVisit(s, T0 + 2 * DAY);
    expect(arrivalLines(s, v3)).not.toContain(LINES.smallStory);
  });
});
