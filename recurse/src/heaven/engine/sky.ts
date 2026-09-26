import type { Front, OtherSeed, Sky, Weather } from './types';

export const WEATHERS: Weather[] = ['warm', 'rain', 'wind', 'still'];

export const WEATHER_LINE: Record<Weather, string> = {
  warm: 'Warmth, pulled from the lamp.',
  rain: 'Rain, pulled from the shore.',
  wind: 'Wind, pulled through the door.',
  still: 'Stillness, pulled from the bed.',
};

export const FRONT_LIFE = 30;
export const FRONT_R = 0.13;
export const FRONT_MAX = 4;
export const SEEDS_GROWING = 5;
/** Seconds of matching weather to bring a seed to bloom. */
export const GROW_SECONDS = 22;
export const WORLD_AT = 7;

export function newSky(): Sky {
  return { fronts: [], seeds: [], nextId: 1, held: 0, left: 0, stayed: 0 };
}

function spawn(sky: Sky, r: () => number): OtherSeed {
  const s: OtherSeed = {
    id: sky.nextId++,
    x: 0.1 + r() * 0.8,
    y: 0.12 + r() * 0.6,
    need: WEATHERS[Math.floor(r() * WEATHERS.length) % WEATHERS.length],
    growth: 0,
    fate: 'growing',
    since: 0,
  };
  sky.seeds.push(s);
  return s;
}

/** Weather is not aimed at anyone. It falls where you pull it, on whoever is there. */
export function addFront(sky: Sky, kind: Weather, x: number, y: number): Front {
  const f: Front = { kind, x, y, r: FRONT_R, life: FRONT_LIFE };
  sky.fronts.push(f);
  while (sky.fronts.length > FRONT_MAX) sky.fronts.shift();
  return f;
}

export function under(f: Front, s: OtherSeed): boolean {
  const dx = f.x - s.x;
  const dy = f.y - s.y;
  return dx * dx + dy * dy <= f.r * f.r;
}

export interface SkyTick {
  bloomed: OtherSeed[];
}

/**
 * `ambient` is the heaven's own warmth, 0..1: warm-needing seeds grow a little
 * under it with no front at all. That is climate. Nothing here can keep a seed
 * from leaving.
 */
export function tickSky(sky: Sky, dt: number, ambient: number, r: () => number): SkyTick {
  const out: SkyTick = { bloomed: [] };
  while (sky.seeds.filter((s) => s.fate === 'growing').length < SEEDS_GROWING) spawn(sky, r);

  for (const f of sky.fronts) {
    f.life -= dt;
    f.x += dt * 0.002;
  }
  sky.fronts = sky.fronts.filter((f) => f.life > 0 && f.x < 1.2);

  for (const s of sky.seeds) {
    if (s.fate !== 'growing') {
      s.since += dt;
      if (s.fate === 'left') {
        s.y -= dt * 0.02;
        s.x += dt * 0.01;
      }
      continue;
    }
    let rate = 0;
    for (const f of sky.fronts) if (f.kind === s.need && under(f, s)) rate = 1;
    if (s.need === 'warm') rate = Math.max(rate, ambient * 0.06);
    s.growth = Math.min(1, s.growth + (rate * dt) / GROW_SECONDS);
    if (s.growth >= 1) {
      s.fate = r() < 0.4 ? 'left' : 'stayed';
      s.since = 0;
      sky.held += 1;
      if (s.fate === 'left') sky.left += 1;
      else sky.stayed += 1;
      out.bloomed.push(s);
    }
  }
  sky.seeds = sky.seeds.filter((s) => !(s.fate === 'left' && s.since > 14));
  const stayed = sky.seeds.filter((s) => s.fate === 'stayed');
  if (stayed.length > 14) sky.seeds.splice(sky.seeds.indexOf(stayed[0]), 1);
  return out;
}
