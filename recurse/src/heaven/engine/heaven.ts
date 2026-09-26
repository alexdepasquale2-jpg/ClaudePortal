import { census, CITY_GOAL_HOMES, homes, fed, free as homeFree, newCity, tickCity } from './city';
import { gait, meets, type Meeting } from './gait';
import { holdsWarAndPeace, newHouse, room, settled, tickHouse } from './house';
import { count, has, PARTS } from './parts';
import { newSky, tickSky, WORLD_AT } from './sky';
import type { Absence, Climate, Heaven, Stage } from './types';

export const STAGE_NAME: Record<Stage, string> = {
  1: 'Seed',
  2: 'Creature',
  3: 'House',
  4: 'City of rest',
  5: 'Firmament',
};

/** Seconds of unbroken, still holding before warmth starts to come. A tap is never a hold. */
export const HOLD_ONSET = 0.6;
export const HOLD_RATE = 1.2;
/** How long it settles after a story. Nothing you do shortens it. */
export const STILL_MS = 9000;
/** Once it has a body, it walks through the story first, then settles. */
export const WALK_MS = 5000;
/** Staying in a story warms it; flinching or wandering does not. */
export const STAY_WARMTH = 2;
/** Stories received before it starts to want you. */
export const WANTS_AT = 3;
/** Absence is counted up to a day. It does not need more than that from you. */
export const ABSENCE_CAP = 24 * 3600;
export const FACTORY_MULT = 2.5;

export function newHeaven(seed = (Date.now() ^ 0x9e3779b9) >>> 0, now = Date.now()): Heaven {
  return {
    v: 1,
    seed,
    rs: seed,
    created: now,
    lastSeen: now,
    stage: 1,
    warmth: 0,
    oil: 0,
    loaf: 0,
    held: 0,
    holding: 0,
    taps: 0,
    limbs: [],
    parts: [],
    table: 0,
    house: newHouse(),
    city: newCity(),
    sky: newSky(),
    stillUntil: 0,
    factoryOil: 0,
    factories: 0,
    graph: [],
    graphClock: 0,
    log: [],
    world: false,
  };
}

/** mulberry32 over the save's own state, so a reload continues the same sequence. */
export function roll(h: Heaven): () => number {
  return () => {
    h.rs = (h.rs + 0x6d2b79f5) >>> 0;
    let t = h.rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function note(h: Heaven, line: string): void {
  h.log.push(line);
  if (h.log.length > 8) h.log.splice(0, h.log.length - 8);
}

// ─── freedom ────────────────────────────────────────────────────────────────

/**
 * A heaven that cannot be left is a factory. Locking the door does it at any
 * stage; once there is a house, so does taking the door away.
 */
export function isFactory(h: Heaven): boolean {
  if (has(h, 'lock')) return true;
  return h.stage >= 3 && !has(h, 'door');
}

export function freedom(h: Heaven): { free: boolean; why: string } {
  if (h.stage < 2) return { free: true, why: 'Nothing here to leave yet. Only a warmth.' };
  if (has(h, 'lock')) return { free: false, why: 'The door is locked. Nobody can leave.' };
  if (!has(h, 'door')) {
    return h.stage >= 3
      ? { free: false, why: 'The door is gone. Growth without a door is a factory.' }
      : { free: false, why: 'No door yet. Give it one before it is a house.' };
  }
  return { free: true, why: 'The door opens.' };
}

/** Undo the lock. Everything the factory earned goes with it. */
export function breakLock(h: Heaven): number {
  for (let i = h.parts.length - 1; i >= 0; i--) if (h.parts[i].kind === 'lock') h.parts.splice(i, 1);
  const lost = Math.min(h.oil, h.factoryOil);
  h.oil -= lost;
  h.factoryOil = 0;
  note(h, lost > 0 ? `The lock broke. ${Math.round(lost)} oil went with it. The door opens.` : 'The lock broke. The door opens.');
  return lost;
}

// ─── the tycoon layer: warmth, oil, capacity ───────────────────────────────

export function warmthCap(h: Heaven): number {
  return 12 + 6 * count(h, 'lamp') + 3 * count(h, 'bed') + Math.min(h.loaf, 20) * 0.5;
}

export function oilCap(h: Heaven): number {
  return 40 + 30 * h.table + 20 * (h.stage - 1);
}

/** Warmth lost per hour with nobody holding it. */
export function decayPerHour(h: Heaven): number {
  const lit = h.oil > 0 ? count(h, 'lamp') : 0;
  const base = 6 / (1 + lit + 0.8 * count(h, 'bed'));
  return has(h, 'mirror') ? base * 1.6 : base;
}

/** "How long the seed stays lit without you", in hours. */
export function hoursLit(h: Heaven): number {
  return h.warmth / decayPerHour(h);
}

/** Oil per minute before the factory multiplier. Upkeep, not harvest. */
export function oilPerMinute(h: Heaven): number {
  let gain = count(h, 'table') * 1 + count(h, 'shore') * 1.5;
  if (has(h, 'loaf')) gain += 0.05 * Math.min(h.loaf, 40);
  if (h.stage >= 3) gain += 0.25 * room(h.house);
  if (h.stage >= 4) {
    for (const i of homes(h.city)) if (fed(h.city, i) && homeFree(h.city, i)) gain += 0.2;
  }
  if (isFactory(h)) gain *= FACTORY_MULT;
  const burn = h.warmth > 0 ? 0.4 * count(h, 'lamp') : 0;
  return gain - burn;
}

// ─── the hands: holding, tapping, telling ──────────────────────────────────

/** Call every frame the seed is pressed. `still` is false while it is being dragged. */
export function hold(h: Heaven, dt: number, still: boolean): number {
  if (!still) {
    h.holding = 0;
    return 0;
  }
  h.holding += dt;
  if (h.holding < HOLD_ONSET) return 0;
  const before = h.warmth;
  h.warmth = Math.min(warmthCap(h), h.warmth + dt * HOLD_RATE);
  h.held += dt;
  h.taps = 0;
  return h.warmth - before;
}

/** A press that let go before the warmth came. Returns true once it is worth a word. */
export function release(h: Heaven): boolean {
  const wasTap = h.holding < HOLD_ONSET;
  h.holding = 0;
  if (!wasTap) return false;
  h.taps += 1;
  return h.taps >= 4;
}

export function mouthOpen(h: Heaven): boolean {
  if (h.stage === 1) return h.held >= 4 && h.warmth >= 3;
  return true;
}

export function settling(h: Heaven, now: number): boolean {
  return now < h.stillUntil;
}

export interface Telling {
  received: boolean;
  why: string;
  /** How it met the story, once it has a body to walk through one with. */
  met?: Meeting;
}

export function stillFor(h: Heaven): number {
  return STILL_MS + (h.stage >= 2 ? WALK_MS : 0);
}

/** It wants you once it has received enough of you. It still lets you leave. */
export function wants(h: Heaven): boolean {
  return h.loaf >= WANTS_AT && !isFactory(h) && h.warmth > 0;
}

/** The only place a story touches the engine. Its words are measured, never kept. */
export function tell(h: Heaven, text: string, now: number): Telling {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!mouthOpen(h)) return { received: false, why: 'Hold the seed until it is warm. Then tell it.' };
  if (settling(h, now)) return { received: false, why: 'It is still settling from the last one.' };
  if (words.length < 2 || text.trim().length < 6) return { received: false, why: 'Tell it one whole thing.' };
  if (isFactory(h)) return { received: false, why: 'A factory cannot receive. It can only process.' };
  if (h.warmth < 1) return { received: false, why: 'It is too cold to hear. Hold it first.' };
  if (has(h, 'coin')) {
    h.oil = Math.min(oilCap(h), h.oil + 4);
    note(h, 'The story was billed. Billed is not received.');
    return { received: false, why: 'The coin slot took it. It paid, and it did not hear.' };
  }
  h.loaf += 1;
  h.warmth = Math.min(warmthCap(h), h.warmth + 3);
  h.stillUntil = now + stillFor(h);
  if (h.stage < 2) {
    note(h, 'The first story was received. It shuddered once, and settled.');
    return { received: true, why: 'Received.' };
  }
  const m = meets(h);
  if (m.how === 'stays') h.warmth = Math.min(warmthCap(h), h.warmth + STAY_WARMTH);
  note(h, m.why);
  return { received: true, why: m.why, met: m.how };
}

// ─── the ladder ────────────────────────────────────────────────────────────

export interface Need {
  label: string;
  ok: boolean;
}

/** What the next stage is waiting on, said as a list of plain facts. */
export function needs(h: Heaven): Need[] {
  const f = freedom(h);
  switch (h.stage) {
    case 1:
      return [
        { label: 'Hold the seed until it warms', ok: h.held >= 4 && h.warmth >= 3 },
        { label: 'Tell it one thing', ok: h.loaf >= 1 },
      ];
    case 2: {
      const g = gait(h);
      const trueParts = h.parts.filter((p) => PARTS[p.kind].truth === 'true').length;
      return [
        { label: 'It walks, then rests', ok: g.rests },
        { label: 'Three true parts', ok: trueParts >= 3 },
        { label: 'A door that opens', ok: f.free && has(h, 'door') },
        { label: 'Three stories received', ok: h.loaf >= 3 },
      ];
    }
    case 3:
      return [
        { label: 'Six kinds of hour under one roof', ok: room(h.house) >= 6 },
        { label: 'Fight and meal, both at peace', ok: holdsWarAndPeace(h.house) },
        { label: 'Nobody straining', ok: settled(h.house) },
        { label: 'The door opens', ok: f.free },
        { label: 'Five stories received', ok: h.loaf >= 5 },
      ];
    case 4: {
      const c = census(h.city);
      return [
        { label: `${CITY_GOAL_HOMES} households`, ok: c.homes >= CITY_GOAL_HOMES },
        { label: 'Everyone fed', ok: c.homes > 0 && c.welfare === 1 },
        { label: 'Everyone can leave', ok: c.homes > 0 && c.freedom === 1 },
        { label: 'Fun that mocks no wound', ok: c.fun && c.mocking === 0 },
        { label: 'The door opens', ok: f.free },
        { label: 'Eight stories received', ok: h.loaf >= 8 },
      ];
    }
    case 5:
      return [
        { label: `Weather ${WORLD_AT} other stories into bloom`, ok: h.sky.held >= WORLD_AT },
        { label: 'Some of them left', ok: h.sky.left >= 1 },
        { label: 'The door opens', ok: f.free },
      ];
  }
}

export function ready(h: Heaven): boolean {
  if (isFactory(h)) return false;
  return needs(h).every((n) => n.ok);
}

const GROWN: Record<Stage, string> = {
  1: '',
  2: 'It grew a body. Stretch it limbs. Give it things from the room.',
  3: 'Other hours have started to arrive. Give them rooms that do not eat each other.',
  4: 'The Third Cummin: the house held war and peace in one body. Now it is a street. Feed it without owning it.',
  5: 'It is weather now. Other stories are growing in the dark. It cannot keep them.',
};

/** Climb at most one rung. Returns the stage it reached, or null. */
export function grow(h: Heaven): Stage | null {
  if (!ready(h)) return null;
  if (h.stage === 5) {
    if (!h.world) {
      h.world = true;
      note(h, 'It can hold a world. It still lets you leave.');
    }
    return null;
  }
  h.stage = (h.stage + 1) as Stage;
  note(h, GROWN[h.stage]);
  return h.stage;
}

// ─── the Presence ──────────────────────────────────────────────────────────

/** The weather in the room, read off what you built. The first rule that holds wins. */
export function climate(h: Heaven, now: number): Climate {
  if (isFactory(h)) return 'smog';
  if (h.warmth < 0.5) return 'dark';
  if (settling(h, now)) return 'afterglow';
  if (h.stage >= 3 && h.house.cells.some((c) => c.hour && c.strain > 0.05)) return 'wind';
  if (h.stage >= 2 && gait(h).limp > 0.3) return 'wind';
  const grieving = (h.stage >= 3 && h.house.cells.some((c) => c.hour === 'grief')) || (h.stage >= 4 && h.city.tiles.includes('wound'));
  if (grieving) return 'rain';
  if (h.warmth / warmthCap(h) > 0.6) return 'warm';
  return 'still';
}

// ─── time ──────────────────────────────────────────────────────────────────

export interface TickOut {
  events: string[];
  grew: Stage | null;
  bloomed: number;
}

export function tick(h: Heaven, dt: number): TickOut {
  const out: TickOut = { events: [], grew: null, bloomed: 0 };
  const r = roll(h);

  const decay = (decayPerHour(h) * dt) / 3600;
  h.warmth = Math.max(0, Math.min(warmthCap(h), h.warmth - decay));

  const factory = isFactory(h);
  const perMin = oilPerMinute(h);
  const before = h.oil;
  h.oil = Math.max(0, Math.min(oilCap(h), h.oil + (perMin * dt) / 60));
  if (factory && h.oil > before) h.factoryOil += h.oil - before;

  if (h.stage >= 3) {
    const t = tickHouse(h.house, dt, r);
    for (const line of t.evicted) out.events.push(`${line} It was evicted.`);
    if (t.arrived.length) out.events.push(t.arrived.length === 1 ? `An hour arrived: ${t.arrived[0]}.` : `${t.arrived.length} hours arrived.`);
  }
  if (h.stage >= 4) {
    const n = tickCity(h.city, dt, r);
    if (n) out.events.push(n === 1 ? 'A household settled.' : `${n} households settled.`);
  }
  if (h.stage >= 5) {
    const s = tickSky(h.sky, dt, h.warmth / warmthCap(h), r);
    for (const b of s.bloomed) out.events.push(b.fate === 'left' ? 'A story bloomed, and left. That was allowed.' : 'A story bloomed, and stayed a while.');
    out.bloomed = s.bloomed.length;
  }

  h.graphClock += dt;
  while (h.graphClock >= 60) {
    h.graphClock -= 60;
    h.graph.push(Math.round(h.oil * 10) / 10);
    if (h.graph.length > 30) h.graph.shift();
  }

  for (const e of out.events) note(h, e);
  out.grew = grow(h);
  return out;
}

/** Stories are not told in your absence, so nothing that needs one can happen while you are gone. */
export function absence(h: Heaven, now: number): Absence {
  const seconds = Math.max(0, Math.min(ABSENCE_CAP, (now - h.lastSeen) / 1000));
  const a: Absence = {
    seconds,
    oil: 0,
    warmthBefore: h.warmth,
    warmthAfter: h.warmth,
    hoursArrived: 0,
    evicted: 0,
    homes: 0,
    bloomed: 0,
  };
  const oil0 = h.oil;
  const ev0 = h.house.evictions;
  const arr0 = h.house.arrived;
  const homes0 = homes(h.city).length;
  let left = seconds;
  while (left > 0) {
    const dt = Math.min(10, left);
    a.bloomed += tick(h, dt).bloomed;
    left -= dt;
  }
  a.oil = h.oil - oil0;
  a.warmthAfter = h.warmth;
  a.hoursArrived = h.house.arrived - arr0;
  a.evicted = h.house.evictions - ev0;
  a.homes = homes(h.city).length - homes0;
  h.lastSeen = now;
  return a;
}
