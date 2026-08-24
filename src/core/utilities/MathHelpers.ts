/**
 * Small numeric helpers shared across layers.
 *
 * Everything here is allocation-free and takes plain numbers. Vector maths belongs to Three.js in
 * the render layer; core deliberately does not depend on it (see ARCHITECTURE.md — core imports
 * nothing).
 */

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const clamp01 = (value: number): number => clamp(value, 0, 1);

export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/** Inverse lerp; returns 0 when the range is degenerate rather than dividing by zero. */
export const inverseLerp = (from: number, to: number, value: number): number =>
  from === to ? 0 : (value - from) / (to - from);

export const remap = (
  value: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number,
): number => lerp(toMin, toMax, inverseLerp(fromMin, fromMax, value));

/** Smooth 0→1 falloff. Used for influence volumes and noise attenuation. */
export const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01(inverseLerp(edge0, edge1, value));
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent approach. `smoothing` is the fraction remaining after one second. */
export const damp = (current: number, target: number, smoothing: number, dt: number): number =>
  lerp(target, current, Math.pow(clamp01(smoothing), dt));

export const distanceSquared2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

export const distanceSquared3 = (
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number => {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
};

/** Inverse-square-ish falloff with a floor, for noise and influence. Never returns negative. */
export const falloff = (distance: number, radius: number): number =>
  radius <= 0 ? 0 : clamp01(1 - distance / radius);
