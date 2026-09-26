// What Heaven remembers, on this device only. No feed. No sync. No cloud.

import { composeReply, type Reply } from './reply';
import { ASKS, LINES } from './voice';
import { type Weather, inferWeather } from './weather';

export type PartId = 'door' | 'loaf' | 'lamp' | 'table' | 'shore' | 'ornament';
export const MAX_ON = 3;
export const LONG_ABSENCE_DAYS = 4;
export const SHAPE_KNOTS = 12;

export interface Seed {
  id: string;
  text: string;
  at: number;
  ask: string;
  weather: Weather;
  reply: Reply;
  /** Where it sits on the body, polar, unit oval. */
  a: number;
  r: number;
  continues: string | null;
  settled: boolean;
  residue: boolean;
}

export interface PlacedPart {
  id: PartId;
  a: number;
  r: number;
}

export interface Save {
  v: 1;
  name: string | null;
  nameAgain: boolean;
  opens: number;
  lastOpenAt: number;
  lastLeftAt: number;
  seeds: Seed[];
  rim: PartId[];
  on: PlacedPart[];
  shape: number[];
  press: { a: number; r: number };
  thin: number;
  narrow: boolean;
  askCursor: number;
  removedOther: boolean;
  lingered: boolean;
  ornamentAtLeave: boolean;
  owesSmallStory: boolean;
}

export type Motion = 'system' | 'full' | 'reduced';
export interface Settings {
  textScale: number;
  motion: Motion;
  sound: boolean;
}

export type VisitKind = 'first' | 'sameDay' | 'nextDay' | 'long';

export interface Visit {
  kind: VisitKind;
  daysAway: number;
  canWalk: boolean;
  restlessFirstWalk: boolean;
  /** A day or more with the door on: warmer, breath slower. */
  carried: boolean;
  /** 0..1, several days away. Shore makes it gentler. */
  cool: number;
  askName: boolean;
  nameSkipped: boolean;
  continuation: Seed | null;
  setAside: boolean;
  freshAsk: string;
  smallStory: boolean;
  late: boolean;
  given: Seed | null;
}

export function freshSave(): Save {
  return {
    v: 1,
    name: null,
    nameAgain: false,
    opens: 0,
    lastOpenAt: 0,
    lastLeftAt: 0,
    seeds: [],
    rim: [],
    on: [],
    shape: new Array(SHAPE_KNOTS).fill(1),
    press: { a: -Math.PI / 2, r: 0.2 },
    thin: 0,
    narrow: false,
    askCursor: 0,
    removedOther: false,
    lingered: false,
    ornamentAtLeave: false,
    owesSmallStory: false,
  };
}

export function defaultSettings(): Settings {
  return { textScale: 1, motion: 'system', sound: false };
}

// ---------- time ----------

function midnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole local calendar days between two instants. */
export function dayDiff(from: number, to: number): number {
  return Math.max(0, Math.round((midnight(to) - midnight(from)) / 86_400_000));
}

export function hourLabel(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const m = d.getMinutes();
  const suffix = h < 12 ? 'am' : 'pm';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`;
}

// ---------- reading the body ----------

export const isOn = (s: Save, id: PartId) => s.on.some((p) => p.id === id);

export interface Posture {
  door: boolean;
  loaf: boolean;
  lamp: boolean;
  table: boolean;
  shore: boolean;
  ornament: boolean;
  resting: boolean;
  hitched: boolean;
  narrow: boolean;
  warm: boolean;
  thin: number;
  roomy: boolean;
}

export function weathers(s: Save): Set<Weather> {
  return new Set(s.seeds.map((x) => x.weather));
}

export function posture(s: Save, v: Visit | null): Posture {
  const door = isOn(s, 'door');
  const ornament = isOn(s, 'ornament');
  const kinds = weathers(s).size;
  const resting = kinds >= 2 && door && !ornament;
  return {
    door,
    loaf: isOn(s, 'loaf'),
    lamp: isOn(s, 'lamp'),
    table: isOn(s, 'table'),
    shore: isOn(s, 'shore'),
    ornament,
    resting,
    hitched: ornament,
    narrow: s.narrow,
    warm: door && s.seeds.length > 0 && !!v && v.kind !== 'first',
    thin: door ? 0 : s.thin,
    roomy: s.seeds.length >= 3 && kinds >= 2 && resting,
  };
}

/** The last three seeds share one weather. */
export function isNarrow(s: Save): boolean {
  if (s.seeds.length < 3) return false;
  const last = s.seeds.slice(-3).map((x) => x.weather);
  return last.every((w) => w === last[0]);
}

// ---------- opening ----------

function unlock(s: Save): void {
  if (s.rim.length === 0) return;
  const add = (id: PartId) => {
    if (!s.rim.includes(id)) s.rim.push(id);
  };
  if (s.opens >= 2 && s.seeds.some((x) => x.text.trim() !== '' && x.settled)) {
    add('lamp');
    add('table');
    add('shore');
  }
  if (s.removedOther || s.opens >= 3) add('ornament');
}

/** Called once the thumb has stayed through the gate. Nothing is stored before this. */
export function openVisit(s: Save, now: number): Visit {
  const hadOpened = s.opens > 0;
  const days = hadOpened ? dayDiff(s.lastOpenAt || s.lastLeftAt, now) : 0;
  const door = isOn(s, 'door');
  const lamp = isOn(s, 'lamp');

  // Away. Change shows only on open.
  if (door) s.thin = 0;
  else if (s.rim.includes('door') && days > 0) s.thin = Math.min(6, s.thin + days);

  s.opens += 1;
  const kind: VisitKind = !hadOpened
    ? 'first'
    : days >= LONG_ABSENCE_DAYS
      ? 'long'
      : days >= 1
        ? 'nextDay'
        : 'sameDay';

  const restless = s.ornamentAtLeave || (s.lingered && !lamp);
  s.lingered = false;

  const askName = s.name === null && (s.opens === 1 || s.nameAgain);
  s.nameAgain = false;

  const smallStory = s.owesSmallStory;
  s.owesSmallStory = false;

  const latest = s.seeds[s.seeds.length - 1];
  const continuation = latest && latest.text.trim() !== '' && dayDiff(latest.at, now) >= 1 ? latest : null;

  unlock(s);
  s.lastOpenAt = now;
  const hour = new Date(now).getHours();

  return {
    kind,
    daysAway: days,
    canWalk: s.opens >= 2,
    restlessFirstWalk: restless,
    carried: door && days >= 1 && days < LONG_ABSENCE_DAYS,
    cool: kind === 'long' ? (isOn(s, 'shore') ? 0.45 : 1) : 0,
    askName,
    nameSkipped: false,
    continuation,
    setAside: false,
    freshAsk: ASKS[s.askCursor % ASKS.length]!,
    smallStory,
    late: hour >= 23 || hour < 4,
    given: null,
  };
}

/** The Presence's first words this visit, one at a time. */
export function arrivalLines(s: Save, v: Visit): string[] {
  const out: string[] = [];
  if (v.kind !== 'first' && s.name) out.push(`${s.name}.`);
  if (v.kind === 'first') out.push(LINES.firstArrival);
  else if (v.kind === 'long') out.push(LINES.longAbsence);
  else if (v.kind === 'nextDay') out.push(LINES.nextDay);
  else out.push(LINES.earn);
  if (v.late) out.push(LINES.late);
  if (v.smallStory) out.push(LINES.smallStory);
  return out;
}

export function currentAsk(v: Visit): string {
  return v.continuation && !v.setAside ? LINES.continuation : v.freshAsk;
}

// ---------- giving ----------

let counter = 0;
const newId = (now: number) => `${now.toString(36)}-${(counter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export function give(s: Save, v: Visit, text: string, now: number, rand: () => number = Math.random): Seed {
  const continuing = v.continuation && !v.setAside ? v.continuation : null;
  const ask = currentAsk(v);
  const seed: Seed = {
    id: newId(now),
    text,
    at: now,
    ask,
    weather: inferWeather(text),
    reply: composeReply(text),
    a: rand() * Math.PI * 2,
    r: 0.25 + rand() * 0.5,
    continues: continuing ? continuing.id : null,
    settled: false,
    residue: false,
  };
  s.seeds.push(seed);
  if (!continuing) s.askCursor += 1;
  if (s.rim.length === 0) s.rim.push('door', 'loaf');
  s.owesSmallStory = seed.reply.owesSmallStory;
  v.given = seed;
  v.continuation = null;
  return seed;
}

/** How long after the reply before the body sits, in ms. */
export function settleDelay(s: Save, seed: Seed): number {
  let ms = 6500;
  if (isOn(s, 'loaf')) ms -= 2200;
  if (isOn(s, 'table') && seed.weather === 'meal') ms -= 1500;
  return ms;
}

/** The body has sat. Returns whether a late warmth may come. */
export function settle(s: Save, seed: Seed): boolean {
  seed.settled = true;
  s.narrow = isNarrow(s);
  if (s.opens >= 2) unlock(s);
  return seed.continues !== null && isOn(s, 'door');
}

export function keepResidue(seed: Seed): void {
  seed.residue = true;
}

// ---------- hands ----------

/** Returns false when the body already holds three; the part goes back by itself. */
export function placePart(s: Save, id: PartId, a: number, r: number): boolean {
  if (!s.rim.includes(id) || isOn(s, id)) return false;
  if (s.on.length >= MAX_ON) return false;
  s.on.push({ id, a, r });
  if (id === 'door') s.thin = 0;
  return true;
}

export function removePart(s: Save, id: PartId): void {
  const before = s.on.length;
  s.on = s.on.filter((p) => p.id !== id);
  if (s.on.length !== before && id !== 'ornament') {
    s.removedOther = true;
    unlock(s);
  }
}

export function leaveVisit(s: Save, now: number): void {
  s.lastLeftAt = now;
  s.ornamentAtLeave = isOn(s, 'ornament');
}

export function forgetName(s: Save): void {
  s.name = null;
  s.nameAgain = true;
}

// ---------- storage ----------

export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStore implements Store {
  private m = new Map<string, string>();
  get(k: string) {
    return this.m.get(k) ?? null;
  }
  set(k: string, v: string) {
    this.m.set(k, v);
  }
  remove(k: string) {
    this.m.delete(k);
  }
}

export function localStore(): Store {
  try {
    const ls = window.localStorage;
    const probe = '__heaven_probe';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      get: (k) => ls.getItem(k),
      set: (k, v) => {
        try {
          ls.setItem(k, v);
        } catch {
          /* full or blocked: the room still works tonight */
        }
      },
      remove: (k) => ls.removeItem(k),
    };
  } catch {
    return new MemoryStore();
  }
}

export const SAVE_KEY = 'heaven.v1';
export const SETTINGS_KEY = 'heaven.settings';

export function loadSave(store: Store): Save {
  const raw = store.get(SAVE_KEY);
  if (!raw) return freshSave();
  try {
    const parsed = JSON.parse(raw) as Partial<Save>;
    const s = { ...freshSave(), ...parsed } as Save;
    if (!Array.isArray(s.shape) || s.shape.length !== SHAPE_KNOTS) s.shape = freshSave().shape;
    return s;
  } catch {
    return freshSave();
  }
}

export function writeSave(store: Store, s: Save): void {
  store.set(SAVE_KEY, JSON.stringify(s));
}

/** Delete every story. The light remains: settings stay. */
export function deleteAll(store: Store): Save {
  store.remove(SAVE_KEY);
  return freshSave();
}

export function loadSettings(store: Store): Settings {
  const raw = store.get(SETTINGS_KEY);
  if (!raw) return defaultSettings();
  try {
    return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return defaultSettings();
  }
}

export function writeSettings(store: Store, st: Settings): void {
  store.set(SETTINGS_KEY, JSON.stringify(st));
}
