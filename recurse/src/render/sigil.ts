/**
 * sigil.ts — every node draws itself.
 *
 * A sigil is a pure function of `{seed, growth, depth, hue}`. Modes are
 * registered against that one interface, so a fourth mode is a single new
 * function plus an entry in MODES — nothing else in the codebase changes.
 */

import type { SigilParams } from '../engine/procgen';
import { accentRgb, cssRgb, hslToRgb } from './palette';

export interface SigilInput {
  seed: SigilParams;
  /** 0..1-ish, how developed the node is. Drives size and stroke weight. */
  growth: number;
  /** Recursion depth to draw. Grows with generators bought and output. */
  depth: number;
  hue: number;
  /** Seconds, for modes that animate. Ignored when motion is reduced. */
  time: number;
  /** When true, draw the resting frame of the animation and nothing more. */
  still: boolean;
}

export type SigilMode = 'fractal' | 'spiral' | 'rings';

export type SigilDrawer = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  input: SigilInput,
) => void;

// ---------------------------------------------------------------------------

/**
 * Segment ceiling for the fractal mode. A branching tree draws
 * branches^depth segments, so an unclamped depth of 9 at 5 branches is nearly
 * two million strokes in a frame that has 16ms to spare. Depth is clamped to
 * whatever the node's own branch count can afford within this budget, which
 * means bushy sigils grow shallow and sparse ones grow deep — visually the
 * right answer as well as the fast one.
 */
const FRACTAL_BUDGET = 2000;

function affordableDepth(branches: number, wanted: number): number {
  if (branches <= 1) return wanted;
  const max = Math.floor(Math.log(FRACTAL_BUDGET) / Math.log(branches));
  return Math.max(1, Math.min(wanted, max));
}

/** Recursive branching tree — the literal shape of the game's premise. */
const fractal: SigilDrawer = (ctx, w, h, input) => {
  const { seed, growth, hue, time, still } = input;
  const depth = affordableDepth(seed.branches, input.depth);
  const cx = w / 2;
  const cy = h * 0.94;
  const len = h * 0.3 * (0.6 + 0.4 * growth);
  const sway = still ? 0 : Math.sin(time * 0.6) * seed.wobble * 0.12;

  const stroke = accentRgb(hue);
  ctx.lineCap = 'round';

  const branch = (x: number, y: number, angle: number, length: number, level: number): void => {
    if (level > depth || length < 0.7) return;
    const ex = x + Math.cos(angle) * length;
    const ey = y + Math.sin(angle) * length;
    const fade = 1 - level / (depth + 1.5);
    ctx.strokeStyle = `rgba(${stroke.r} ${stroke.g} ${stroke.b} / ${(0.25 + 0.65 * fade).toFixed(3)})`;
    ctx.lineWidth = Math.max(0.5, (1 + growth * 2.2) * fade);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    const spread = seed.angle;
    for (let i = 0; i < seed.branches; i++) {
      const t = seed.branches === 1 ? 0 : i / (seed.branches - 1) - 0.5;
      branch(ex, ey, angle + t * spread * 2 + seed.twist * 0.35 + sway, length * seed.shrink, level + 1);
    }
  };

  branch(cx, cy, -Math.PI / 2, len, 0);
};

/** Logarithmic spiral — turns scale with growth. */
const spiral: SigilDrawer = (ctx, w, h, input) => {
  const { seed, growth, depth, hue, time, still } = input;
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(w, h) * 0.44;
  const turns = 1.4 + growth * 4 + depth * 0.35;
  const steps = Math.max(48, Math.floor(turns * 42));
  const b = 0.16 + seed.shrink * 0.22;
  const phase = still ? 0 : time * 0.25 * (0.4 + seed.wobble);

  const c = accentRgb(hue);
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.8, 1 + growth * 2.4);

  for (let arm = 0; arm < seed.branches; arm++) {
    const off = (arm / seed.branches) * Math.PI * 2 + seed.twist;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * turns * Math.PI * 2;
      const r = maxR * Math.exp(b * (t - turns * Math.PI * 2)) ;
      const a = t + off + phase;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const alpha = 0.85 - (arm / seed.branches) * 0.45;
    ctx.strokeStyle = `rgba(${c.r} ${c.g} ${c.b} / ${alpha.toFixed(3)})`;
    ctx.stroke();
  }
};

/** Concentric arcs — one ring per generator, fill fraction = log(count). */
const rings: SigilDrawer = (ctx, w, h, input) => {
  const { seed, growth, depth, hue, time, still, fills } = input as SigilInput & {
    fills?: number[];
  };
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(w, h) * 0.44;
  const count = fills?.length ?? Math.max(3, Math.min(6, seed.branches + 2));
  const gap = maxR / (count + 0.6);
  const spin = still ? 0 : time * 0.2 * (seed.twist >= 0 ? 1 : -1);
  const c = accentRgb(hue);

  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const r = gap * (i + 1);
    const fill = fills ? clamp01(fills[i]) : clamp01(growth - i * 0.15);
    ctx.lineWidth = Math.max(1.2, gap * 0.42);

    ctx.strokeStyle = `rgba(${c.r} ${c.g} ${c.b} / 0.12)`;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    if (fill <= 0) continue;
    const start = -Math.PI / 2 + spin + i * seed.angle;
    ctx.strokeStyle = `rgba(${c.r} ${c.g} ${c.b} / ${(0.45 + 0.5 * fill).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + Math.PI * 2 * fill);
    ctx.stroke();
  }

  // a core that reads the node's recursion depth
  const core = Math.min(gap * 0.7, 2 + depth * 0.6);
  ctx.fillStyle = cssRgb(c);
  ctx.beginPath();
  ctx.arc(cx, cy, core, 0, Math.PI * 2);
  ctx.fill();
};

function clamp01(x: number): number {
  return !(x > 0) ? 0 : x > 1 ? 1 : x;
}

/**
 * The registry. Adding a mode is one function plus one line here — the UI
 * picker, the codex thumbnails and the settings screen all read from this.
 */
export const MODES: Record<SigilMode, SigilDrawer> = { fractal, spiral, rings };

export const MODE_LABELS: Record<SigilMode, string> = {
  fractal: 'Fractal',
  spiral: 'Spiral',
  rings: 'Rings',
};

export interface DrawOptions extends SigilInput {
  mode: SigilMode;
  /** Ring fill fractions, one per generator. */
  fills?: number[];
  /** Draw a faint background wash in the node's hue. */
  wash?: boolean;
}

export function drawSigil(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: DrawOptions,
): void {
  ctx.clearRect(0, 0, w, h);
  if (opts.wash) {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.62);
    const c = hslToRgb(opts.hue, 0.6, 0.5);
    g.addColorStop(0, `rgba(${c.r} ${c.g} ${c.b} / 0.10)`);
    g.addColorStop(1, 'rgba(0 0 0 / 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  (MODES[opts.mode] ?? fractal)(ctx, w, h, opts);
}

/**
 * Render a sigil to a data URL. Used to freeze a species' thumbnail the first
 * time it is seen, so the codex is a wall of trophies rather than a list.
 */
export function sigilThumbnail(opts: DrawOptions, size = 96): string {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(dpr, dpr);
  drawSigil(ctx, size, size, { ...opts, still: true, time: 0 });
  return canvas.toDataURL('image/png');
}

/**
 * How much of a node is built, as a 0..1-ish number the renderers can use for
 * size and stroke weight without knowing anything about the economy.
 */
export function growthOf(unitsBought: number, lifetime: number): number {
  const a = Math.log10(1 + unitsBought) / 3.2;
  const b = Math.log10(1 + lifetime) / 11;
  return Math.min(1, Math.max(0, a * 0.55 + b * 0.45));
}

export function depthOf(unitsBought: number, doorsOpen: number): number {
  return Math.min(9, 2 + Math.floor(Math.log10(1 + unitsBought) * 1.5) + doorsOpen);
}
