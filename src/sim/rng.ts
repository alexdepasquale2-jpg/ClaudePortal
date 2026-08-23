export type RngState = { s: number };

export function mulberry32(seed: number): RngState { return { s: seed >>> 0 }; }

export function rand(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randInt = (r: RngState, lo: number, hi: number) => lo + Math.floor(rand(r) * (hi - lo + 1));
export const randRange = (r: RngState, lo: number, hi: number) => lo + rand(r) * (hi - lo);
export const roll100 = (r: RngState) => rand(r) * 100;
