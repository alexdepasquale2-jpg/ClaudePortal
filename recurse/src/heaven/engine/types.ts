/**
 * Heaven — a creature you raise, not a franchise you run.
 *
 * The engine is DOM-free and deterministic given `now` and a seed. Time is in
 * seconds unless a name says otherwise. Nothing here ever holds the words of a
 * story: the house keeps that a story was received, never what it said.
 */

export type Stage = 1 | 2 | 3 | 4 | 5;

export type PartKind =
  // true parts: the creature can rest on them
  | 'table'
  | 'lamp'
  | 'loaf'
  | 'shore'
  | 'door'
  | 'bed'
  // vain parts: they attach, and it walks ugly
  | 'crown'
  | 'coin'
  | 'mirror'
  | 'lock';

export interface Limb {
  /** Radians around the body, 0 = right, PI/2 = down. */
  angle: number;
  /** 0..1 of the maximum reach. */
  length: number;
}

export interface Attached {
  kind: PartKind;
  /** Radians around the body where it sits. */
  angle: number;
}

export type Hour = 'fun' | 'fight' | 'need' | 'leaving' | 'anger' | 'meal' | 'unknowing' | 'grief';

export interface HouseCell {
  hour: Hour | null;
  /** 0..1; an hour at 1 is evicted. */
  strain: number;
}

export interface House {
  cols: number;
  rows: number;
  cells: HouseCell[];
  /** Hours waiting on the step. They never get evicted from the step. */
  step: Hour[];
  /** Seconds until the next hour arrives. */
  nextHour: number;
  evictions: number;
  /** How many hours have ever come to the step. Picks who comes next. */
  arrived: number;
}

export type Tile = 'empty' | 'home' | 'wound' | 'table' | 'gate' | 'square' | 'granary';

export interface City {
  cols: number;
  rows: number;
  tiles: Tile[];
  /** Seconds until the next household settles. */
  nextHome: number;
}

export type Weather = 'warm' | 'rain' | 'wind' | 'still';

export interface Front {
  kind: Weather;
  x: number;
  y: number;
  r: number;
  /** Seconds left. */
  life: number;
}

export interface OtherSeed {
  id: number;
  x: number;
  y: number;
  need: Weather;
  growth: number;
  /** 'growing' until it blooms, then it stays or leaves. Both are allowed. */
  fate: 'growing' | 'stayed' | 'left';
  /** Seconds since its fate was decided (for drifting away). */
  since: number;
}

export interface Sky {
  fronts: Front[];
  seeds: OtherSeed[];
  nextId: number;
  held: number;
  left: number;
  stayed: number;
}

export interface Heaven {
  v: 1;
  seed: number;
  /** mulberry32 state, advanced by the engine only. */
  rs: number;
  created: number;
  /** ms epoch of the last tick, so absence can be measured. */
  lastSeen: number;
  stage: Stage;

  warmth: number;
  oil: number;
  /** Stories told and actually received. Only a count. */
  loaf: number;
  /** Seconds the seed has been held, ever. */
  held: number;
  /** Seconds of the current unbroken, still hold. */
  holding: number;
  /** Taps that were not holds, for the gentle hint. Resets on a real hold. */
  taps: number;

  limbs: Limb[];
  parts: Attached[];
  /** Table level: how many parts the body can carry. */
  table: number;

  house: House;
  city: City;
  sky: Sky;

  /** ms epoch before which it is settling after a story. */
  stillUntil: number;
  /** Oil earned while it was a factory; forfeited when the lock breaks. */
  factoryOil: number;
  factories: number;
  /** The last few oil readings, one per minute, for "the graph". */
  graph: number[];
  graphClock: number;

  /** Short afterglow lines. Never contains story text. */
  log: string[];
  /** Set once the firmament holds a world. The game keeps going. */
  world: boolean;
}

/**
 * The Presence is the weather in the room, never a voice. It is read off the
 * heaven's state; nothing in it is random.
 */
export type Climate = 'dark' | 'smog' | 'wind' | 'rain' | 'afterglow' | 'warm' | 'still';

export interface Gait {
  /** 0..1, how evenly it walks. */
  grace: number;
  /** 0..1, how badly it limps. */
  limp: number;
  /** True when every part it carries is true and it has somewhere to put its weight. */
  rests: boolean;
  why: string;
}

export interface Fit {
  ok: boolean;
  /** 'click' belongs, 'limp' attaches but is vain, 'no' will not stay. */
  how: 'click' | 'limp' | 'no';
  why: string;
}

export interface Absence {
  seconds: number;
  oil: number;
  warmthBefore: number;
  warmthAfter: number;
  hoursArrived: number;
  evicted: number;
  homes: number;
  bloomed: number;
}
