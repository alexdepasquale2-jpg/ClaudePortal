/**
 * palette.ts — colour maths for a UI whose hues are procedural.
 *
 * Every node picks its own hue from its seed, so "does this text read?" cannot
 * be answered by eyeballing the default theme. Everything here is pure and
 * tested at hue extremes (tests/state.spec.ts), not just at the hues that
 * happen to show up first.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = clamp01(s);
  const ll = clamp01(l);
  if (ss === 0) {
    const v = Math.round(ll * 255);
    return { r: v, g: v, b: v };
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  return {
    r: Math.round(hue2rgb(p, q, hh + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hh) * 255),
    b: Math.round(hue2rgb(p, q, hh - 1 / 3) * 255),
  };
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** WCAG relative luminance. */
export function luminance(c: Rgb): number {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export const BG: Rgb = { r: 8, g: 9, b: 14 };
export const PANEL: Rgb = { r: 17, g: 19, b: 27 };

/**
 * Yellow at 60% lightness is far brighter than blue at 60% lightness, so a
 * fixed lightness fails WCAG somewhere on the wheel no matter where you set
 * it. Instead, walk lightness up from a floor until the contrast target is
 * actually met against the surface the text sits on. This is what keeps every
 * hue readable, not just the ones in the default theme.
 */
export function readableAccent(
  hue: number,
  against: Rgb = BG,
  target = 4.5,
  saturation = 0.72,
): string {
  let lo = 0.35;
  let hi = 0.95;
  // luminance is monotonic in lightness at fixed hue/saturation, so bisect
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(hslToRgb(hue, saturation, mid), against) >= target) hi = mid;
    else lo = mid;
  }
  const l = hi;
  const c = hslToRgb(hue, saturation, l);
  return `rgb(${c.r} ${c.g} ${c.b})`;
}

export function accentRgb(hue: number, against: Rgb = BG, target = 4.5, saturation = 0.72): Rgb {
  let lo = 0.35;
  let hi = 0.95;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(hslToRgb(hue, saturation, mid), against) >= target) hi = mid;
    else lo = mid;
  }
  return hslToRgb(hue, saturation, hi);
}

/** A dim companion colour for borders and fills — never used to carry text. */
export function veil(hue: number, alpha = 0.18): string {
  const c = hslToRgb(hue, 0.6, 0.5);
  return `rgba(${c.r} ${c.g} ${c.b} / ${alpha})`;
}

export function cssRgb(c: Rgb): string {
  return `rgb(${c.r} ${c.g} ${c.b})`;
}
