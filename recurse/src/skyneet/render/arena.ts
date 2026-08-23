import { machineCompetence } from '../engine/competence';
import { tileAt } from '../engine/operation';
import type { Machine, Operation } from '../engine/types';

const TILE = 22;

function biomeFloor(biome: Operation['biome']): string {
  if (biome === 'sump') return '#141a18';
  if (biome === 'foundry') return '#1b1410';
  if (biome === 'lattice') return '#12141a';
  if (biome === 'hum') return '#16120f';
  if (biome === 'trunk') return '#101412';
  return '#15130f';
}

function machineColor(m: Machine, competent: boolean): string {
  if (m.kind === 'sancient') return '#3ee0d0';
  if (m.kind === 'nobot') return '#8a7ec4';
  if (competent) return '#e07050';
  return '#8a5a3a';
}

export function worldFromScreen(
  canvas: HTMLCanvasElement,
  op: Operation,
  sx: number,
  sy: number,
): { x: number; y: number } {
  const camx = op.player.x * TILE - canvas.clientWidth / 2;
  const camy = op.player.y * TILE - canvas.clientHeight / 2;
  const scale = canvas.width / canvas.clientWidth;
  return {
    x: (sx * scale + camx) / TILE,
    y: (sy * scale + camy) / TILE,
  };
}

export function drawArena(canvas: HTMLCanvasElement, op: Operation, aimX: number, aimY: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#070806';
  ctx.fillRect(0, 0, w, h);

  const camx = op.player.x * TILE - w / 2;
  const camy = op.player.y * TILE - h / 2;
  ctx.save();
  ctx.translate(-camx, -camy);

  const x0 = Math.max(0, Math.floor(camx / TILE) - 1);
  const y0 = Math.max(0, Math.floor(camy / TILE) - 1);
  const x1 = Math.min(op.w - 1, Math.ceil((camx + w) / TILE) + 1);
  const y1 = Math.min(op.h - 1, Math.ceil((camy + h) / TILE) + 1);
  const floor = biomeFloor(op.biome);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = op.tiles[y * op.w + x];
      const px = x * TILE;
      const py = y * TILE;
      if (t === 'wall') {
        ctx.fillStyle = '#0a0908';
        ctx.fillRect(px, py, TILE, TILE);
        continue;
      }
      ctx.fillStyle = t === 'water' ? '#0d2a28' : t === 'elevator' ? '#1c2a18' : t === 'works' ? '#2a2214' : floor;
      ctx.fillRect(px, py, TILE, TILE);
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
    }
  }

  for (const wr of op.wrecks) {
    if (wr.scrap <= 0) continue;
    ctx.fillStyle = '#6a5340';
    ctx.fillRect(wr.x * TILE - 5, wr.y * TILE - 4, 10, 8);
  }

  for (const b of op.buildings) {
    ctx.fillStyle =
      b.kind === 'nnn' ? '#3ee0d0' : b.kind === 'chrome' ? '#d4a24a' : b.kind === 'extractor' ? '#8a7a4a' : '#5a5348';
    ctx.fillRect(b.x * TILE - 8, b.y * TILE - 8, 16, 16);
    if (b.kind === 'nnn' && op.nnnLit) {
      ctx.strokeStyle = 'rgba(62,224,208,0.35)';
      ctx.beginPath();
      ctx.arc(b.x * TILE, b.y * TILE, 38, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const windowOpen = op.sancientWindow > 0;
  const san = op.machines.find((m) => m.kind === 'sancient' && m.hp > 0);
  for (const m of op.machines) {
    if (m.hp <= 0) continue;
    const near = !!(san && Math.hypot(m.x - san.x, m.y - san.y) < 9.5);
    const c = machineCompetence(m, windowOpen, near);
    const px = m.x * TILE;
    const py = m.y * TILE;
    ctx.fillStyle = machineColor(m, c > 0.85);
    const s = m.kind === 'siege' ? 14 : m.kind === 'sancient' ? 10 : 11;
    ctx.fillRect(px - s / 2, py - s / 2, s, s);
    if (m.telegraph > 0.15) {
      ctx.strokeStyle = c > 0.85 ? 'rgba(224,80,64,0.9)' : 'rgba(196,160,80,0.45)';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(m.tx * TILE, m.ty * TILE);
      ctx.stroke();
    }
    ctx.fillStyle = '#2a1c16';
    ctx.fillRect(px - 8, py - s / 2 - 5, 16, 2);
    ctx.fillStyle = '#c45a4a';
    ctx.fillRect(px - 8, py - s / 2 - 5, 16 * (m.hp / m.maxHp), 2);
  }

  for (const s of op.shots) {
    ctx.fillStyle = s.from === 'machine' ? '#c4653a' : '#3ee0d0';
    ctx.fillRect(s.x * TILE - 1.5, s.y * TILE - 1.5, 3, 3);
  }

  const ppx = op.player.x * TILE;
  const ppy = op.player.y * TILE;
  ctx.fillStyle = '#c8c2b4';
  ctx.beginPath();
  ctx.arc(ppx, ppy, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,194,180,0.35)';
  ctx.beginPath();
  ctx.moveTo(ppx, ppy);
  ctx.lineTo(aimX * TILE, aimY * TILE);
  ctx.stroke();

  const t = tileAt(op, op.player.x, op.player.y);
  if (t === 'elevator') {
    ctx.fillStyle = '#8fb36a';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('ELEVATOR · hold L to lift', ppx + 10, ppy - 10);
  }

  ctx.restore();
}
