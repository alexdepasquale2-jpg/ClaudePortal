import type { City, Tile } from './types';

export type Build = 'table' | 'gate' | 'square' | 'granary';

export const BUILD_COST: Record<Build, number> = { table: 14, gate: 10, square: 8, granary: 6 };

export const BUILD_LINE: Record<Build, string> = {
  table: 'Feeds the homes beside it. Owns nothing.',
  gate: 'A way out within two streets. Freedom you can see.',
  square: 'Somewhere to play. Keep it away from the wounded.',
  granary: 'Feeds twice as far, and owns whoever it feeds.',
};

export const HOME_INTERVAL = 50;
export const HOME_MAX = 12;
export const CITY_GOAL_HOMES = 8;

export function newCity(): City {
  const cols = 7;
  const rows = 5;
  const tiles: Tile[] = Array.from({ length: cols * rows }, () => 'empty');
  tiles[Math.floor(rows / 2) * cols + Math.floor(cols / 2)] = 'home';
  return { cols, rows, tiles, nextHome: 12 };
}

function xy(c: City, i: number): [number, number] {
  return [i % c.cols, Math.floor(i / c.cols)];
}

function dist(c: City, a: number, b: number): number {
  const [ax, ay] = xy(c, a);
  const [bx, by] = xy(c, b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function within(c: City, i: number, kind: Tile, r: number): boolean {
  for (let j = 0; j < c.tiles.length; j++) if (c.tiles[j] === kind && dist(c, i, j) <= r) return true;
  return false;
}

export function isHome(t: Tile): boolean {
  return t === 'home' || t === 'wound';
}

export function homes(c: City): number[] {
  const out: number[] = [];
  c.tiles.forEach((t, i) => isHome(t) && out.push(i));
  return out;
}

export function fed(c: City, i: number): boolean {
  return within(c, i, 'table', 1) || within(c, i, 'granary', 2);
}

export function owned(c: City, i: number): boolean {
  return within(c, i, 'granary', 2);
}

export function free(c: City, i: number): boolean {
  return within(c, i, 'gate', 2) && !owned(c, i);
}

/** A square beside a wounded home is fun that mocks the wound. */
export function mocking(c: City, i: number): boolean {
  return c.tiles[i] === 'square' && within(c, i, 'wound', 1);
}

export interface Census {
  homes: number;
  welfare: number;
  freedom: number;
  fun: boolean;
  mocking: number;
  owned: number;
}

export function census(c: City): Census {
  const hs = homes(c);
  const n = hs.length;
  let f = 0;
  let fr = 0;
  let own = 0;
  for (const i of hs) {
    if (fed(c, i)) f++;
    if (free(c, i)) fr++;
    if (owned(c, i)) own++;
  }
  let mock = 0;
  let play = false;
  c.tiles.forEach((t, i) => {
    if (t !== 'square') return;
    if (mocking(c, i)) mock++;
    else if (hs.some((h) => dist(c, h, i) <= 2)) play = true;
  });
  return {
    homes: n,
    welfare: n ? f / n : 0,
    freedom: n ? fr / n : 0,
    fun: play,
    mocking: mock,
    owned: own,
  };
}

/** Rest means everyone is fed, everyone can leave, and the fun hurts no one. */
export function atRest(c: City): boolean {
  const s = census(c);
  return s.homes >= CITY_GOAL_HOMES && s.welfare === 1 && s.freedom === 1 && s.fun && s.mocking === 0;
}

export function canBuild(c: City, i: number, oil: number, b: Build): boolean {
  return c.tiles[i] === 'empty' && oil >= BUILD_COST[b];
}

export function build(c: City, i: number, b: Build): number {
  if (c.tiles[i] !== 'empty') return 0;
  c.tiles[i] = b;
  return BUILD_COST[b];
}

/** Clearing a built tile returns half its oil. Homes are never cleared. */
export function clear(c: City, i: number): number {
  const t = c.tiles[i];
  if (t === 'empty' || isHome(t)) return 0;
  c.tiles[i] = 'empty';
  return Math.floor(BUILD_COST[t as Build] / 2);
}

/** Households settle beside other households. Every third one arrives wounded. */
export function tickCity(c: City, dt: number, r: () => number): number {
  let settled = 0;
  c.nextHome -= dt;
  while (c.nextHome <= 0) {
    c.nextHome += HOME_INTERVAL;
    const hs = homes(c);
    if (hs.length >= HOME_MAX) continue;
    const spots: number[] = [];
    c.tiles.forEach((t, i) => {
      if (t === 'empty' && hs.some((h) => dist(c, h, i) === 1)) spots.push(i);
    });
    if (spots.length === 0) continue;
    const at = spots[Math.floor(r() * spots.length) % spots.length];
    c.tiles[at] = (hs.length + 1) % 3 === 0 ? 'wound' : 'home';
    settled++;
  }
  return settled;
}
