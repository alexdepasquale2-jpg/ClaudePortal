/**
 * Geometry and text summary for XUI charts, kept free of Svelte so it is testable.
 * Marks follow the house chart rules: bars at most 24px wide with a 4px rounded
 * data end, 2px gaps between touching bars, 2px lines, hairline gridlines.
 */

import type { XuiNode } from './api';

export type ChartNode = Extract<XuiNode, { type: 'chart' }>;

/** Series beyond this many are listed in the data table only (no cycled hues). */
export const MAX_SERIES = 4;

const BAR_MAX = 24;
const BAR_GAP = 2;
const MIN_X_LABEL_SPACING = 56;

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** Short number for ticks and labels: 1,284 -> "1.3K". */
export function fmt(v: number): string {
  return Math.abs(v) >= 10_000 ? compact.format(v) : plain.format(v);
}

/** Round tick values covering [lo, hi], always including zero. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  let min = Math.min(0, lo);
  let max = Math.max(0, hi);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

export interface Mark {
  series: number;
  index: number;
  value: number;
  /** Hover text, e.g. "Tue · glasses: 5". */
  title: string;
}

export interface Bar extends Mark {
  d: string;
}

export interface Point extends Mark {
  x: number;
  y: number;
}

export interface Geometry {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  ticks: { y: number; label: string }[];
  xLabels: { x: number; label: string }[];
  bars: Bar[];
  lines: { series: number; d: string; points: Point[] }[];
  /** The one value labeled directly: the highest bar, or each line's last point. */
  callouts: { x: number; y: number; label: string; anchor: 'start' | 'middle' }[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A bar from `base` to `y` with a rounded end away from the baseline. */
function barPath(x: number, w: number, base: number, y: number): string {
  const h = Math.abs(base - y);
  const r = Math.min(4, w / 2, h);
  const s = y < base ? 1 : -1; // up for positive values, down for negative
  return (
    `M${r2(x)},${r2(base)}V${r2(y + s * r)}` +
    `Q${r2(x)},${r2(y)} ${r2(x + r)},${r2(y)}H${r2(x + w - r)}` +
    `Q${r2(x + w)},${r2(y)} ${r2(x + w)},${r2(y + s * r)}V${r2(base)}Z`
  );
}

function truncate(s: string, chars: number): string {
  return s.length <= chars ? s : `${s.slice(0, Math.max(1, chars - 1))}…`;
}

/** Lays out the chart for a plot area of `width` x `height` CSS pixels. */
export function layout(node: ChartNode, width: number, height: number): Geometry {
  const x = node.x ?? [];
  const series = (node.series ?? []).slice(0, MAX_SERIES);
  const values = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const tickLabels = ticks.map(fmt);

  const isLine = node.kind === 'line';
  const left = 12 + 7 * Math.max(...tickLabels.map((t) => t.length));
  const right = isLine ? 48 : 12;
  const top = 20;
  const bottom = 28;
  const plotW = Math.max(1, width - left - right);
  const plotH = Math.max(1, height - top - bottom);
  const yOf = (v: number) => top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const base = yOf(Math.max(lo, Math.min(0, hi)));
  const n = Math.max(1, x.length);
  const band = plotW / n;
  const centre = (i: number) => left + band * (i + 0.5);

  const every = Math.max(1, Math.ceil(MIN_X_LABEL_SPACING / band));
  const chars = Math.max(3, Math.floor((band * every) / 7));
  const xLabels = x
    .map((label, i) => ({ x: centre(i), label: truncate(label, chars), i }))
    .filter(({ i }) => i % every === 0)
    .map(({ x: px, label }) => ({ x: px, label }));

  const title = (si: number, i: number, v: number) =>
    `${x[i] ?? ''} · ${series[si].name}: ${fmt(v)}`;

  const geometry: Geometry = {
    width,
    height,
    left,
    right,
    top,
    bottom,
    ticks: ticks.map((v, i) => ({ y: yOf(v), label: tickLabels[i] })),
    xLabels,
    bars: [],
    lines: [],
    callouts: [],
  };

  if (isLine) {
    series.forEach((s, si) => {
      const points = s.values.map((v, i) => ({
        series: si,
        index: i,
        value: v,
        title: title(si, i, v),
        x: centre(i),
        y: yOf(v),
      }));
      const d = points.map((p, i) => `${i ? 'L' : 'M'}${r2(p.x)},${r2(p.y)}`).join('');
      geometry.lines.push({ series: si, d, points });
      const last = points[points.length - 1];
      if (last) {
        geometry.callouts.push({
          x: last.x + 8,
          y: last.y,
          label: fmt(last.value),
          anchor: 'start',
        });
      }
    });
    return geometry;
  }

  const k = Math.max(1, series.length);
  const groupW = Math.min(band * 0.72, BAR_MAX * k + BAR_GAP * (k - 1));
  const barW = Math.max(1, (groupW - BAR_GAP * (k - 1)) / k);
  let top1: Bar | undefined;
  series.forEach((s, si) => {
    s.values.forEach((v, i) => {
      const bx = centre(i) - groupW / 2 + si * (barW + BAR_GAP);
      const bar = {
        series: si,
        index: i,
        value: v,
        title: title(si, i, v),
        d: barPath(bx, barW, base, yOf(v)),
      };
      geometry.bars.push(bar);
      if (!top1 || v > top1.value) top1 = bar;
    });
  });
  if (top1 && top1.value > 0) {
    const bx = centre(top1.index) - groupW / 2 + top1.series * (barW + BAR_GAP) + barW / 2;
    geometry.callouts.push({
      x: bx,
      y: yOf(top1.value) - 6,
      label: fmt(top1.value),
      anchor: 'middle',
    });
  }
  return geometry;
}

/** A plain-language description of the chart for screen readers and captions. */
export function summary(node: ChartNode): string {
  const x = node.x ?? [];
  const all = node.series ?? [];
  const what = `${node.kind === 'line' ? 'Line' : 'Bar'} chart${node.y ? ` of ${node.y}` : ''}`;
  if (x.length === 0 || all.length === 0) return `${what} with no data.`;
  const span = x.length === 1 ? x[0] : `${x[0]} to ${x[x.length - 1]}`;
  const parts = all.slice(0, MAX_SERIES).map((s) => {
    let lo = 0;
    let hi = 0;
    s.values.forEach((v, i) => {
      if (v < s.values[lo]) lo = i;
      if (v > s.values[hi]) hi = i;
    });
    const last = s.values[s.values.length - 1];
    return (
      `${s.name}: highest ${fmt(s.values[hi])} (${x[hi]}), ` +
      `lowest ${fmt(s.values[lo])} (${x[lo]}), latest ${fmt(last)}`
    );
  });
  const more = all.length - MAX_SERIES;
  const tail = more > 0 ? ` ${more} more series are in the data table.` : '';
  return `${what}, ${span}. ${parts.join('. ')}.${tail}`;
}
