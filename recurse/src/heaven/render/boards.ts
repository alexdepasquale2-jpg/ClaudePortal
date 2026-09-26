import { BUILD_COST, fed, free, isHome, mocking, owned, type Build } from '../engine/city';
import { byDoor, threat } from '../engine/house';
import { WEATHERS } from '../engine/sky';
import type { City, Hour, House, Sky, Weather } from '../engine/types';
import { drawPart, INK } from './glyphs';

export const HOUR_INK: Record<Hour, string> = {
  meal: INK.honey,
  fun: INK.moss,
  need: INK.sea,
  fight: INK.rust,
  leaving: INK.bone,
  grief: INK.plum,
  anger: INK.ember,
  unknowing: INK.steel,
};

export const HOUR_WORD: Record<Hour, string> = {
  meal: 'meal',
  fun: 'fun',
  need: 'need',
  fight: 'fight',
  leaving: 'leaving',
  grief: 'grief',
  anger: 'anger',
  unknowing: 'not-knowing',
};

/** The part of the screen a board may use: clear of the HUD, the tabs and the mouth. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Grid {
  x: number;
  y: number;
  cell: number;
  cols: number;
  rows: number;
}

export function cellAt(g: Grid, px: number, py: number): number {
  const c = Math.floor((px - g.x) / g.cell);
  const r = Math.floor((py - g.y) / g.cell);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return -1;
  return r * g.cols + c;
}

export function cellCenter(g: Grid, i: number): { x: number; y: number } {
  return { x: g.x + ((i % g.cols) + 0.5) * g.cell, y: g.y + (Math.floor(i / g.cols) + 0.5) * g.cell };
}

// ─── house ─────────────────────────────────────────────────────────────────

/** The step sits outside the west door, so the grid leaves room for it on the left. */
export function houseGrid(house: House, r: Rect): Grid {
  const cell = Math.min((r.w - 110) / house.cols, (r.h - 70) / house.rows, 120);
  const gw = cell * house.cols;
  const x = r.x + 110 + Math.max(0, (r.w - 110 - gw) / 2);
  return { x, y: r.y + 10, cell, cols: house.cols, rows: house.rows };
}

export function stepPos(g: Grid, i: number): { x: number; y: number } {
  return { x: g.x - 70, y: g.y + g.cell * 0.4 + i * 58 };
}

function hourToken(ctx: CanvasRenderingContext2D, hour: Hour, x: number, y: number, r: number, strain: number, t: number): void {
  const col = HOUR_INK[hour];
  const tremble = strain > 0 ? Math.sin(t * 30) * strain * 2.5 : 0;
  ctx.save();
  ctx.translate(x + tremble, y);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.5);
  g.addColorStop(0, col + '55');
  g.addColorStop(1, col + '00');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = col;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (strain > 0.02) {
    ctx.strokeStyle = INK.rust;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.75, -Math.PI / 2, -Math.PI / 2 + strain * Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = INK.bone;
  ctx.font = `${Math.max(11, r * 0.34)}px ui-serif, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.fillText(HOUR_WORD[hour], 0, r * 1.05);
  ctx.restore();
}

export function drawHouse(
  ctx: CanvasRenderingContext2D,
  house: House,
  g: Grid,
  t: number,
  drag: { hour: Hour; x: number; y: number; fromStep: number; fromCell: number } | null,
  hoverCell: number,
): void {
  const W = g.cell * g.cols;
  const H = g.cell * g.rows;
  ctx.fillStyle = 'rgba(40,30,44,0.55)';
  ctx.fillRect(g.x, g.y, W, H);
  for (let i = 0; i < house.cells.length; i++) {
    const c = cellCenter(g, i);
    ctx.strokeStyle = 'rgba(239,230,214,0.08)';
    ctx.strokeRect(c.x - g.cell / 2 + 3, c.y - g.cell / 2 + 3, g.cell - 6, g.cell - 6);
    if (byDoor(house, i)) {
      ctx.fillStyle = 'rgba(255,207,138,0.04)';
      ctx.fillRect(c.x - g.cell / 2 + 3, c.y - g.cell / 2 + 3, g.cell - 6, g.cell - 6);
    }
    if (i === hoverCell && drag) {
      ctx.strokeStyle = 'rgba(255,207,138,0.5)';
      ctx.strokeRect(c.x - g.cell / 2 + 3, c.y - g.cell / 2 + 3, g.cell - 6, g.cell - 6);
    }
  }
  // walls, with the door on the west wall standing open
  ctx.strokeStyle = INK.bone;
  ctx.lineWidth = 3;
  const doorTop = g.y + H / 2 - g.cell * 0.35;
  const doorBot = g.y + H / 2 + g.cell * 0.35;
  ctx.beginPath();
  ctx.moveTo(g.x, doorTop);
  ctx.lineTo(g.x, g.y);
  ctx.lineTo(g.x + W, g.y);
  ctx.lineTo(g.x + W, g.y + H);
  ctx.lineTo(g.x, g.y + H);
  ctx.lineTo(g.x, doorBot);
  ctx.stroke();
  ctx.strokeStyle = INK.warm;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(g.x, doorTop);
  ctx.lineTo(g.x - g.cell * 0.45, doorTop + g.cell * 0.2);
  ctx.stroke();

  house.cells.forEach((c, i) => {
    if (!c.hour || drag?.fromCell === i) return;
    const p = cellCenter(g, i);
    hourToken(ctx, c.hour, p.x, p.y - 6, g.cell * 0.3, c.strain, t);
  });

  ctx.fillStyle = INK.mute;
  ctx.font = '12px ui-serif, Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('the step', g.x - 70, g.y + 14);
  house.step.forEach((hour, i) => {
    if (drag && drag.fromStep === i) return;
    const p = stepPos(g, i);
    const bob = Math.sin(t * 1.2 + i) * 2;
    hourToken(ctx, hour, p.x, p.y + bob, 22, 0, t);
  });
  if (drag) hourToken(ctx, drag.hour, drag.x, drag.y, g.cell * 0.3, 0, t);
}

export function houseThreatLines(house: House): string[] {
  const out = new Set<string>();
  house.cells.forEach((_, i) => {
    const l = threat(house, i);
    if (l) out.add(l);
  });
  return [...out];
}

// ─── city ──────────────────────────────────────────────────────────────────

export const BUILDS: Build[] = ['table', 'gate', 'square', 'granary'];

export function cityGrid(city: City, r: Rect): Grid {
  const cell = Math.min(r.w / city.cols, (r.h - 110) / city.rows, 86);
  const gw = cell * city.cols;
  return { x: r.x + (r.w - gw) / 2, y: r.y + 10, cell, cols: city.cols, rows: city.rows };
}

export function buildPos(g: Grid, i: number): { x: number; y: number } {
  const span = Math.max(g.cell * g.cols, 320);
  const x0 = g.x + (g.cell * g.cols - span) / 2;
  return { x: x0 + span * ((i + 0.5) / BUILDS.length), y: g.y + g.cell * g.rows + 60 };
}

function drawBuild(ctx: CanvasRenderingContext2D, b: Build, x: number, y: number, s: number, t: number, alpha = 1): void {
  if (b === 'table') drawPart(ctx, 'table', x, y, s, 0, alpha, t);
  else if (b === 'gate') drawPart(ctx, 'door', x, y, s, 0, alpha, t);
  else if (b === 'granary') {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = INK.gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-s * 0.7 + x, s * 0.8 + y);
    ctx.lineTo(-s * 0.7 + x, -s * 0.2 + y);
    ctx.lineTo(x, -s * 0.9 + y);
    ctx.lineTo(s * 0.7 + x, -s * 0.2 + y);
    ctx.lineTo(s * 0.7 + x, s * 0.8 + y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    drawPart(ctx, 'lock', x, y + s * 0.25, s * 0.35, 0, alpha, t);
  } else {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = INK.moss;
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      const a = t * 0.8 + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * s * 0.4, y + Math.sin(a) * s * 0.4, s * 0.18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function drawCity(
  ctx: CanvasRenderingContext2D,
  city: City,
  g: Grid,
  oil: number,
  t: number,
  drag: { build: Build; x: number; y: number } | null,
  hoverCell: number,
): void {
  const s = g.cell * 0.3;
  city.tiles.forEach((tile, i) => {
    const c = cellCenter(g, i);
    ctx.fillStyle = 'rgba(40,30,44,0.45)';
    ctx.fillRect(c.x - g.cell / 2 + 2, c.y - g.cell / 2 + 2, g.cell - 4, g.cell - 4);
    if (i === hoverCell && drag) {
      ctx.strokeStyle = tile === 'empty' ? 'rgba(255,207,138,0.6)' : 'rgba(201,100,74,0.6)';
      ctx.strokeRect(c.x - g.cell / 2 + 2, c.y - g.cell / 2 + 2, g.cell - 4, g.cell - 4);
    }
    if (isHome(tile)) {
      const isFed = fed(city, i);
      const isFree = free(city, i);
      const isOwned = owned(city, i);
      ctx.fillStyle = isFed ? (tile === 'wound' ? INK.plum : INK.warm) : '#5a4a50';
      ctx.globalAlpha = isFed ? 0.9 : 0.6;
      ctx.beginPath();
      ctx.moveTo(c.x - s, c.y + s * 0.8);
      ctx.lineTo(c.x - s, c.y - s * 0.1);
      ctx.lineTo(c.x, c.y - s);
      ctx.lineTo(c.x + s, c.y - s * 0.1);
      ctx.lineTo(c.x + s, c.y + s * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      // a lit doorway if they can leave; bars if they are owned
      ctx.fillStyle = isFree ? INK.night : 'transparent';
      ctx.fillRect(c.x - s * 0.2, c.y + s * 0.2, s * 0.4, s * 0.6);
      if (isOwned) {
        ctx.strokeStyle = INK.rust;
        ctx.lineWidth = 2;
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath();
          ctx.moveTo(c.x + k * s * 0.4, c.y - s * 0.3);
          ctx.lineTo(c.x + k * s * 0.4, c.y + s * 0.8);
          ctx.stroke();
        }
      }
      if (tile === 'wound') {
        ctx.fillStyle = INK.mute;
        ctx.font = '10px ui-serif, Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('grieving', c.x, c.y + g.cell * 0.45);
      }
    } else if (tile !== 'empty') {
      drawBuild(ctx, tile as Build, c.x, c.y, s, t);
      if (tile === 'square' && mocking(city, i)) {
        ctx.strokeStyle = INK.rust;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, s * 1.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  });
  BUILDS.forEach((b, i) => {
    const p = buildPos(g, i);
    const afford = oil >= BUILD_COST[b];
    drawBuild(ctx, b, p.x, p.y - 8, 18, t, afford ? 1 : 0.35);
    ctx.fillStyle = afford ? INK.bone : INK.mute;
    ctx.font = '12px ui-serif, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${b} · ${BUILD_COST[b]} oil`, p.x, p.y + 28);
  });
  if (drag) drawBuild(ctx, drag.build, drag.x, drag.y, s, t, 0.85);
}

// ─── sky ───────────────────────────────────────────────────────────────────

export const WEATHER_INK: Record<Weather, string> = {
  warm: INK.warm,
  rain: INK.sea,
  wind: INK.bone,
  still: INK.plum,
};

const WELL_PART = { warm: 'lamp', rain: 'shore', wind: 'door', still: 'bed' } as const;

export function wellPos(r: Rect, i: number): { x: number; y: number } {
  return { x: r.x + r.w * ((i + 0.5) / WEATHERS.length), y: r.y + r.h - 40 };
}

export function skyBox(r: Rect): Rect {
  return { x: r.x, y: r.y, w: r.w, h: r.h - 100 };
}

export function drawSky(
  ctx: CanvasRenderingContext2D,
  sky: Sky,
  r: Rect,
  t: number,
  drag: { kind: Weather; x: number; y: number } | null,
): void {
  const b = skyBox(r);
  ctx.strokeStyle = 'rgba(239,230,214,0.06)';
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  for (const f of sky.fronts) {
    const x = b.x + f.x * b.w;
    const y = b.y + f.y * b.h;
    const r = f.r * Math.min(b.w, b.h) * 1.3;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = Math.min(1, f.life / 6);
    g.addColorStop(0, WEATHER_INK[f.kind] + Math.round(0x44 * a).toString(16).padStart(2, '0'));
    g.addColorStop(1, WEATHER_INK[f.kind] + '00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (f.kind === 'rain') {
      ctx.strokeStyle = 'rgba(124,199,217,0.35)';
      ctx.lineWidth = 1;
      for (let k = 0; k < 10; k++) {
        const rx = x + Math.sin(k * 12.9) * r * 0.7;
        const ry = y + ((t * 60 + k * 23) % (r * 1.2)) - r * 0.6;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 2, ry + 7);
        ctx.stroke();
      }
    } else if (f.kind === 'wind') {
      ctx.strokeStyle = 'rgba(239,230,214,0.25)';
      for (let k = 0; k < 3; k++) {
        const yy = y - r * 0.4 + k * r * 0.4;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.7, yy);
        ctx.quadraticCurveTo(x, yy - 8 * Math.sin(t * 2 + k), x + r * 0.7, yy);
        ctx.stroke();
      }
    }
  }
  for (const s of sky.seeds) {
    const x = b.x + s.x * b.w;
    const y = b.y + s.y * b.h;
    const col = WEATHER_INK[s.need];
    if (s.fate === 'growing') {
      const r = 4 + s.growth * 10;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.4 + s.growth * 0.6;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.font = '10px ui-serif, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(`needs ${s.need}`, x, y + 30);
      ctx.globalAlpha = 1;
    } else {
      const fade = s.fate === 'left' ? Math.max(0, 1 - s.since / 14) : 1;
      const tw = 0.7 + 0.3 * Math.sin(t * 1.5 + s.id);
      ctx.globalAlpha = fade * tw;
      ctx.fillStyle = s.fate === 'left' ? INK.bone : INK.warm;
      ctx.beginPath();
      ctx.arc(x, y, s.fate === 'left' ? 3 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  WEATHERS.forEach((kind, i) => {
    const p = wellPos(r, i);
    ctx.fillStyle = 'rgba(40,30,44,0.6)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 14, 34, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    drawPart(ctx, WELL_PART[kind], p.x, p.y - 4, 16, 0, 1, t);
    ctx.fillStyle = INK.mute;
    ctx.font = '12px ui-serif, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(kind, p.x, p.y + 40);
  });
  if (drag) {
    const g = ctx.createRadialGradient(drag.x, drag.y, 0, drag.x, drag.y, 50);
    g.addColorStop(0, WEATHER_INK[drag.kind] + '66');
    g.addColorStop(1, WEATHER_INK[drag.kind] + '00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(drag.x, drag.y, 50, 0, Math.PI * 2);
    ctx.fill();
  }
}
