// The glass: a small pixel canvas scaled up without smoothing.
// Night indigo, lamp-oil gold, linen, one living white. Ordered dithering
// feathers the body into the dark the way an old lamp would on a CRT.

import type { PartId } from '../engine/state';

export const PIXELS_WIDE = 128;

type RGB = [number, number, number];

// The ramp, dark to bright. Middle steps are only blends of the four named colours.
const NIGHT: RGB = [10, 11, 30];
const INDIGO: RGB = [22, 22, 56];
const GOLD: RGB = [217, 164, 65];
const LINEN: RGB = [236, 225, 200];
const WHITE: RGB = [255, 246, 226];

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const BASE_RAMP: RGB[] = [
  NIGHT,
  INDIGO,
  mix(INDIGO, GOLD, 0.2),
  mix(INDIGO, GOLD, 0.45),
  mix(INDIGO, GOLD, 0.75),
  GOLD,
  mix(GOLD, LINEN, 0.5),
  LINEN,
  WHITE,
];
const TOP = BASE_RAMP.length - 1;

export const INK = 3; // dark oil, for marks on the body
export const RIM_INK = 7; // linen, for marks on the dark

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((b) => (b + 0.5) / 16);

// Tiny sprites. Readable after one use. Not a sticker sheet.
const SPRITES: Record<PartId, string[]> = {
  door: ['X', 'X', 'X', 'X'],
  table: ['XXXXX', 'X...X'],
  shore: ['XXXXXXX'],
  loaf: ['.X', 'XX'],
  lamp: ['XX', 'XX'],
  ornament: ['.XX', 'X.X', 'X..', '.X.'],
};

export interface BodyView {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  shape: number[];
  bump: { a: number; amt: number };
  heat: number;
  gold: number;
  cool: number;
  press: { a: number; r: number };
  core: number;
  facing: number;
  room: number;
  roomCx: number;
  roomCy: number;
  roomRx: number;
  roomRy: number;
  dim: number;
}

export interface Mark {
  x: number;
  y: number;
  sprite: PartId;
  ink: number;
  drop?: number;
}

export interface SeedMark {
  x: number;
  y: number;
  big: boolean;
  seed: number;
}

export interface Late {
  x: number;
  y: number;
  amount: number;
}

export function radiusAt(shape: number[], bump: { a: number; amt: number }, theta: number): number {
  const k = shape.length;
  let t = (theta / (Math.PI * 2)) * k;
  t = ((t % k) + k) % k;
  const i = Math.floor(t);
  const f = t - i;
  const a = shape[i]!;
  const b = shape[(i + 1) % k]!;
  const w = (1 - Math.cos(f * Math.PI)) / 2;
  let r = a + (b - a) * w;
  if (bump.amt !== 0) {
    let d = theta - bump.a;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    r *= 1 + bump.amt * Math.exp(-(d * d) / 0.5);
  }
  return r;
}

/** Normalised distance from the body's centre: 1 is the edge. */
export function bodyDistance(b: BodyView, x: number, y: number): number {
  const dx = (x - b.cx) / b.rx;
  const dy = (y - b.cy) / b.ry;
  return Math.hypot(dx, dy) / radiusAt(b.shape, b.bump, Math.atan2(dy, dx));
}

export function onBody(b: BodyView, a: number, r: number): { x: number; y: number } {
  const R = radiusAt(b.shape, b.bump, a);
  return { x: b.cx + Math.cos(a) * r * R * b.rx, y: b.cy + Math.sin(a) * r * R * b.ry };
}

export class Glass {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  W = PIXELS_WIDE;
  H = 256;
  private ramp: RGB[] = BASE_RAMP.slice();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(cssW: number, cssH: number): void {
    this.W = PIXELS_WIDE;
    this.H = Math.max(160, Math.round((PIXELS_WIDE * cssH) / Math.max(1, cssW)));
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.img = this.ctx.createImageData(this.W, this.H);
  }

  /** CSS pixels to glass pixels. */
  toGlass(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * this.W, y: ((clientY - r.top) / r.height) * this.H };
  }

  toCss(x: number, y: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (x / this.W) * r.width, y: r.top + (y / this.H) * r.height };
  }

  private tint(gold: number, cool: number, dim: number): void {
    const poor = mix(INDIGO, [120, 104, 96], 0.5);
    const coolTo: RGB = [120, 132, 190];
    for (let i = 0; i <= TOP; i++) {
      let c = BASE_RAMP[i]!;
      if (i >= 2) {
        c = mix(poor, c, 0.35 + 0.65 * gold);
        c = mix(c, coolTo, cool * 0.28 * (i / TOP));
      }
      this.ramp[i] = mix(NIGHT, c, dim);
    }
  }

  draw(b: BodyView, marks: Mark[], seeds: SeedMark[], residues: { x: number; y: number }[], late: Late | null): void {
    const img = this.img;
    if (!img) return;
    const { W, H } = this;
    const data = img.data;
    this.tint(b.gold, b.cool, b.dim);
    const ramp = this.ramp;

    // Press spot and core in glass coordinates.
    const pR = radiusAt(b.shape, b.bump, b.press.a);
    const px = b.cx + Math.cos(b.press.a) * b.press.r * pR * b.rx;
    const py = b.cy + Math.sin(b.press.a) * b.press.r * pR * b.ry;
    const pSig = 2 * Math.pow(Math.max(2, b.rx * 0.32), 2);
    const coreY = b.cy + b.ry * 0.35 * b.facing;
    const roomOn = b.room > 0.001;

    for (let y = 0; y < H; y++) {
      const fy = y + 0.5;
      for (let x = 0; x < W; x++) {
        const fx = x + 0.5;
        let I = 0;
        if (roomOn) {
          const rdx = (fx - b.roomCx) / (b.roomRx * b.room);
          const rdy = (fy - b.roomCy) / (b.roomRy * b.room);
          const rd = rdx * rdx + rdy * rdy;
          if (rd < 1.6) I += 0.17 * Math.max(0, 1 - rd * 0.62) * Math.min(1, b.room * 1.2);
        }
        const dx = (fx - b.cx) / b.rx;
        const dy = (fy - b.cy) / b.ry;
        if (dx > -2.2 && dx < 2.2 && dy > -2.2 && dy < 2.2) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          const d = dist / radiusAt(b.shape, b.bump, Math.atan2(dy, dx));
          let v = d < 1 ? 0.5 + 0.28 * (1 - d * d) : 0.5 * Math.exp(-(d - 1) * 4.2);
          // Linen at the edge: a thin lifted rim before the feather.
          if (d > 0.84 && d < 1.02) v += 0.09 * Math.sin(((d - 0.84) / 0.18) * Math.PI);
          if (d < 1.3) {
            const ex = fx - px;
            const ey = fy - py;
            v += 0.16 * Math.exp(-(ex * ex + ey * ey) / pSig);
            const cx2 = (fx - b.cx) / b.rx;
            const cy2 = (fy - coreY) / b.ry;
            v += b.core * 0.22 * Math.exp(-(cx2 * cx2 + cy2 * cy2) / 0.09);
          }
          I += v * b.heat;
        }
        const L = Math.min(TOP, Math.max(0, I * TOP));
        const lo = Math.floor(L);
        const idx = Math.min(TOP, lo + (L - lo > BAYER[((y & 3) << 2) | (x & 3)]! ? 1 : 0));
        const c = ramp[idx]!;
        const o = (y * W + x) * 4;
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
        data[o + 3] = 255;
      }
    }

    const put = (x: number, y: number, idx: number) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const c = ramp[idx]!;
      const o = (y * W + x) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
    };

    for (const r of residues) put(r.x, r.y, 3);

    // Seeds: smaller than parts, untidy, never sparkling.
    for (const s of seeds) {
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      put(x, y, INK);
      const v = s.seed % 4;
      if (s.big) {
        put(x + (v & 1 ? 1 : -1), y, INK);
        put(x, y + (v & 2 ? 1 : -1), INK);
      } else if (v === 1) {
        put(x + 1, y + 1, INK - 1);
      }
    }

    for (const m of marks) {
      const rows = SPRITES[m.sprite];
      const h = rows.length;
      const w = rows[0]!.length;
      const ox = Math.round(m.x - w / 2);
      const oy = Math.round(m.y - h / 2 + (m.drop ?? 0));
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (rows[j]![i] === 'X') put(ox + i, oy + j, m.ink);
    }

    if (late && late.amount > 0.01) {
      const rad = 1 + late.amount * 2.6;
      for (let j = -4; j <= 4; j++)
        for (let i = -4; i <= 4; i++) {
          const d = Math.hypot(i, j) / rad;
          if (d >= 1.25) continue;
          const L = Math.min(TOP, (d < 1 ? 5 + (1 - d) * 2 * late.amount : 3.4) * Math.min(1, late.amount * 1.4));
          const lo = Math.floor(L);
          const xx = Math.round(late.x) + i;
          const yy = Math.round(late.y) + j;
          const idx = lo + (L - lo > BAYER[((yy & 3) << 2) | (xx & 3)]! ? 1 : 0);
          if (idx >= 2) put(xx, yy, Math.min(TOP, idx));
        }
    }

    this.ctx.putImageData(img, 0, 0);
  }
}
