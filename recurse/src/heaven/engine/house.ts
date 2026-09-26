import type { Hour, House } from './types';

export const HOURS: Hour[] = ['meal', 'fun', 'need', 'fight', 'leaving', 'grief', 'anger', 'unknowing'];

/** The first eight arrive in this order so each rule shows up once before they mix. */
const FIRST: Hour[] = ['meal', 'fun', 'need', 'fight', 'leaving', 'grief', 'anger', 'unknowing'];

export const HOUR_INTERVAL = 75;
export const STEP_MAX = 3;
/** Seconds of unrelieved conflict before an hour is evicted. */
export const EVICT_SECONDS = 40;

/** predator → victim. Each of these, adjacent and unmediated, evicts the victim. */
export const EATS: [Hour, Hour, string][] = [
  ['fight', 'need', 'The fight ate the need.'],
  ['fun', 'grief', 'The fun mocked the wound.'],
  ['anger', 'unknowing', 'Anger demanded an answer from not-knowing.'],
];

export function newHouse(): House {
  const cols = 4;
  const rows = 3;
  return {
    cols,
    rows,
    cells: Array.from({ length: cols * rows }, () => ({ hour: null, strain: 0 })),
    step: [],
    nextHour: 8,
    evictions: 0,
    arrived: 0,
  };
}

export function neighbours(house: House, i: number): number[] {
  const c = i % house.cols;
  const r = Math.floor(i / house.cols);
  const out: number[] = [];
  if (c > 0) out.push(i - 1);
  if (c < house.cols - 1) out.push(i + 1);
  if (r > 0) out.push(i - house.cols);
  if (r < house.rows - 1) out.push(i + house.cols);
  return out;
}

/** The door is on the west wall. */
export function byDoor(house: House, i: number): boolean {
  return i % house.cols === 0;
}

/** Why this hour is under strain, or null when it is at peace where it is. */
export function threat(house: House, i: number): string | null {
  const hour = house.cells[i].hour;
  if (!hour) return null;
  if (hour === 'leaving' && !byDoor(house, i)) return 'Leaving has no way out. Put it by the door.';
  const near = neighbours(house, i).map((j) => house.cells[j].hour);
  if (near.includes('meal')) return null;
  for (const [pred, victim, line] of EATS) {
    if (hour === victim && near.includes(pred)) return line;
  }
  return null;
}

export function room(house: House): number {
  const kinds = new Set<Hour>();
  for (const c of house.cells) if (c.hour) kinds.add(c.hour);
  return kinds.size;
}

export function housed(house: House, hour: Hour): boolean {
  return house.cells.some((c) => c.hour === hour);
}

export function settled(house: House): boolean {
  return house.cells.every((c, i) => !c.hour || (c.strain < 0.2 && threat(house, i) === null));
}

/** Holds war and peace in one body: fight and meal both housed, nothing straining. */
export function holdsWarAndPeace(house: House): boolean {
  return housed(house, 'fight') && housed(house, 'meal') && settled(house);
}

export function nextArrival(arrivedSoFar: number, r: () => number): Hour {
  if (arrivedSoFar < FIRST.length) return FIRST[arrivedSoFar];
  return HOURS[Math.floor(r() * HOURS.length) % HOURS.length];
}

export function place(house: House, stepIndex: number, cell: number): boolean {
  if (stepIndex < 0 || stepIndex >= house.step.length) return false;
  const c = house.cells[cell];
  if (!c || c.hour) return false;
  c.hour = house.step.splice(stepIndex, 1)[0];
  c.strain = 0;
  return true;
}

export function move(house: House, from: number, to: number): boolean {
  if (from === to) return false;
  const a = house.cells[from];
  const b = house.cells[to];
  if (!a?.hour || !b || b.hour) return false;
  b.hour = a.hour;
  b.strain = a.strain;
  a.hour = null;
  a.strain = 0;
  return true;
}

/** Walk an hour back out to the step. Nobody is thrown out for asking. */
export function unplace(house: House, cell: number): boolean {
  const c = house.cells[cell];
  if (!c?.hour || house.step.length >= STEP_MAX + 1) return false;
  house.step.push(c.hour);
  c.hour = null;
  c.strain = 0;
  return true;
}

export interface HouseTick {
  arrived: Hour[];
  evicted: string[];
}

/** Strain rises only while a threat stands; it drains twice as fast once the threat is gone. */
export function tickHouse(house: House, dt: number, r: () => number): HouseTick {
  const out: HouseTick = { arrived: [], evicted: [] };
  house.nextHour -= dt;
  while (house.nextHour <= 0) {
    if (house.step.length < STEP_MAX) {
      const hour = nextArrival(house.arrived, r);
      house.arrived += 1;
      house.step.push(hour);
      out.arrived.push(hour);
    }
    house.nextHour += HOUR_INTERVAL;
  }
  const threats = house.cells.map((_, i) => threat(house, i));
  house.cells.forEach((c, i) => {
    if (!c.hour) return;
    if (threats[i]) {
      c.strain += dt / EVICT_SECONDS;
      if (c.strain >= 1) {
        out.evicted.push(threats[i]!);
        c.hour = null;
        c.strain = 0;
        house.evictions += 1;
      }
    } else {
      c.strain = Math.max(0, c.strain - (2 * dt) / EVICT_SECONDS);
    }
  });
  return out;
}
