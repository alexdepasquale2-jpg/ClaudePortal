/** Number and time formatting. Pure, so it is safe to call from a hot loop. */

import type { Settings } from '../../engine/state';

const LETTERS = [
  '', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
  'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg',
];

export function fmt(x: number, notation: Settings['notation'] = 'scientific'): string {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '—';
  const n = Math.abs(x);
  if (n < 1e-3 && n > 0) return x.toExponential(2);
  if (n < 1000) {
    if (n < 10) return trim(x.toFixed(2));
    if (n < 100) return trim(x.toFixed(1));
    return String(Math.round(x));
  }
  switch (notation) {
    case 'letters': {
      const tier = Math.floor(Math.log10(n) / 3);
      if (tier < LETTERS.length) {
        const scaled = x / Math.pow(1000, tier);
        return `${trim(scaled.toFixed(scaled < 10 ? 2 : scaled < 100 ? 1 : 0))}${LETTERS[tier]}`;
      }
      return sci(x);
    }
    case 'engineering': {
      const exp = Math.floor(Math.log10(n) / 3) * 3;
      const mant = x / Math.pow(10, exp);
      return `${trim(mant.toFixed(2))}e${exp}`;
    }
    default:
      return sci(x);
  }
}

function sci(x: number): string {
  const exp = Math.floor(Math.log10(Math.abs(x)));
  const mant = x / Math.pow(10, exp);
  return `${trim(mant.toFixed(2))}e${exp}`;
}

function trim(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Compact duration: 1.4s, 3m 20s, 2h 05m, 3d 4h. */
export function dur(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function stamp(at: number): string {
  if (!at) return '—';
  const d = new Date(at);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function pct(x: number): string {
  const v = Math.max(0, Math.min(1, x));
  if (v > 0 && v < 0.001) return '<0.1%';
  return `${(v * 100).toFixed(v >= 0.1 ? 1 : 2)}%`;
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
