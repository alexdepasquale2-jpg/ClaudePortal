/**
 * One drop, one hole, disposable.
 * Lighting the NNN is a decision, never a step.
 */

import { spend } from './campaign';
import {
  aimSeconds,
  chassis,
  hitChance,
  machineCompetence,
  moveSpeed,
} from './competence';
import {
  deathLine,
  dropLine,
  dumpLine,
  extractLine,
  nnnLine,
  sancientLine,
  wakeLine,
} from './lore';
import { hash, irange, rng } from './rng';
import type {
  BuildKind,
  Campaign,
  FrameInput,
  Machine,
  MachineKind,
  OpResult,
  Operation,
  Shot,
  Site,
  Stock,
  Tile,
} from './types';

export const BUILD_COST: Record<BuildKind, Partial<Stock>> = {
  extractor: { scrap: 10 },
  rack: { scrap: 6 },
  turret: { rack: 6 },
  plate: { plate: 3 },
  nnn: { scrap: 28, rack: 8 },
  chrome: { chrome: 1 },
};

const PLAYER_SPEED = 4.4;
const NEEDLER_CD = 0.22;
const NEEDLER_DMG = 11;

function idx(op: Operation, x: number, y: number): number {
  return y * op.w + x;
}

export function tileAt(op: Operation, x: number, y: number): Tile {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= op.w || ty >= op.h) return 'wall';
  return op.tiles[idx(op, tx, ty)];
}

export function walkable(op: Operation, x: number, y: number): boolean {
  const t = tileAt(op, x, y);
  return t === 'floor' || t === 'water' || t === 'works' || t === 'elevator';
}

function carve(tiles: Tile[], w: number, h: number, x0: number, y0: number, x1: number, y1: number, t: Tile): void {
  const xa = Math.max(1, Math.min(x0, x1));
  const xb = Math.min(w - 2, Math.max(x0, x1));
  const ya = Math.max(1, Math.min(y0, y1));
  const yb = Math.min(h - 2, Math.max(y0, y1));
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) tiles[y * w + x] = t;
}

function generateTiles(site: Site, seed: number): { w: number; h: number; tiles: Tile[]; ex: number; ey: number } {
  const r = rng(hash(`hole:${site.id}:${seed}`));
  const w = 52;
  const h = 34;
  const tiles: Tile[] = Array.from({ length: w * h }, () => 'wall');
  const rooms: { x: number; y: number; ww: number; hh: number }[] = [];
  const roomCount = site.biome === 'lattice' ? 9 : site.biome === 'cavern' ? 5 : 7;
  for (let i = 0; i < roomCount; i++) {
    const ww = site.biome === 'lattice' ? irange(r, 4, 7) : irange(r, 7, 14);
    const hh = site.biome === 'lattice' ? irange(r, 4, 6) : irange(r, 5, 10);
    const x = irange(r, 2, w - ww - 3);
    const y = irange(r, 2, h - hh - 3);
    rooms.push({ x, y, ww, hh });
    carve(tiles, w, h, x, y, x + ww, y + hh, 'floor');
    if (site.biome === 'sump' && r() < 0.55) {
      carve(tiles, w, h, x + 1, y + hh - 2, x + ww - 1, y + hh, 'water');
    }
  }
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1];
    const b = rooms[i];
    const ax = a.x + (a.ww >> 1);
    const ay = a.y + (a.hh >> 1);
    const bx = b.x + (b.ww >> 1);
    const by = b.y + (b.hh >> 1);
    if (r() < 0.5) {
      carve(tiles, w, h, ax, ay, bx, ay, 'floor');
      carve(tiles, w, h, bx, ay, bx, by, 'floor');
    } else {
      carve(tiles, w, h, ax, ay, ax, by, 'floor');
      carve(tiles, w, h, ax, by, bx, by, 'floor');
    }
  }
  const start = rooms[0];
  const ex = start.x + 2;
  const ey = start.y + 2;
  tiles[ey * w + ex] = 'elevator';
  const works = rooms[Math.min(2, rooms.length - 1)];
  tiles[(works.y + 2) * w + (works.x + 2)] = 'works';
  return { w, h, tiles, ex: ex + 0.5, ey: ey + 0.5 };
}

function spawnMachine(op: Operation, kind: MachineKind, x: number, y: number): Machine {
  const spec = chassis(kind);
  const m: Machine = {
    id: op.nextId++,
    kind,
    x,
    y,
    hp: spec.hp,
    maxHp: spec.hp,
    lethality: spec.lethality,
    neutrino: spec.neutrino,
    vx: 0,
    vy: 0,
    aim: 0,
    tx: x,
    ty: y,
    telegraph: 0,
    wander: 0,
    window: kind === 'sancient' ? 0 : 0,
    charge: kind === 'sancient' ? 8 + op.depth * 6 : 0,
  };
  op.machines.push(m);
  return m;
}

function log(op: Operation, line: string): void {
  op.logs.unshift({ t: op.time, line });
  if (op.logs.length > 40) op.logs.length = 40;
}

export function startOperation(campaign: Campaign, siteId: string): Operation {
  const site = campaign.sites[siteId];
  const map = generateTiles(site, campaign.seed);
  const op: Operation = {
    siteId,
    biome: site.biome,
    depth: site.depth,
    w: map.w,
    h: map.h,
    tiles: map.tiles,
    player: { x: map.ex, y: map.ey, hp: 110, maxHp: 110, fireCd: 0 },
    cargo: 0,
    quota: Math.round(16 + site.depth * 22),
    machines: [],
    buildings: [],
    wrecks: [],
    shots: [],
    nnnLit: false,
    nnnId: null,
    loudness: site.loudness,
    sancientWindow: 0,
    sancientId: null,
    time: 0,
    logs: [],
    result: 'running',
    litEver: false,
    jacked: false,
    sancientKilled: false,
    nextId: 1,
  };

  const r = rng(hash(`spawn:${site.id}:${campaign.seed}`));
  const floors: { x: number; y: number }[] = [];
  for (let y = 1; y < op.h - 1; y++) {
    for (let x = 1; x < op.w - 1; x++) {
      const t = op.tiles[y * op.w + x];
      if (t === 'floor' || t === 'water') floors.push({ x: x + 0.5, y: y + 0.5 });
    }
  }
  const far = floors.filter((p) => Math.hypot(p.x - map.ex, p.y - map.ey) > 14);
  const mid = floors.filter((p) => Math.hypot(p.x - map.ex, p.y - map.ey) > 9);
  const pool = far.length ? far : mid.length ? mid : floors;

  const wreckN = 10 + Math.floor(site.depth * 8);
  for (let i = 0; i < wreckN; i++) {
    const p = pool[irange(r, 0, pool.length - 1)];
    op.wrecks.push({ x: p.x, y: p.y, scrap: 3 + Math.floor(r() * 5) });
  }

  const kinds: MachineKind[] = [];
  const gN = 3 + Math.floor(site.depth * 6);
  for (let i = 0; i < gN; i++) {
    if (site.biome === 'foundry') kinds.push(r() < 0.45 ? 'siege' : r() < 0.7 ? 'walker' : 'occupier');
    else if (site.biome === 'cavern') kinds.push(r() < 0.6 ? 'sweeper' : 'occupier');
    else if (site.biome === 'lattice') kinds.push(r() < 0.55 ? 'nobot' : 'occupier');
    else if (site.biome === 'hum') kinds.push(r() < 0.4 ? 'walker' : r() < 0.75 ? 'siege' : 'occupier');
    else kinds.push(r() < 0.4 ? 'occupier' : r() < 0.75 ? 'walker' : 'sweeper');
  }
  if (site.biome === 'lattice') kinds.push('nobot', 'nobot');
  if (site.biome === 'trunk' || site.depth > 0.55 || site.loudness > 0.3) kinds.push('sancient');

  for (const kind of kinds) {
    const p = pool[irange(r, 0, pool.length - 1)];
    spawnMachine(op, kind, p.x, p.y);
  }

  log(op, dropLine(site.biome));
  if (site.biome === 'trunk') log(op, '[SkyNeet] Reach the works. The decision waits above.');
  return op;
}

function tryMove(op: Operation, x: number, y: number, dx: number, dy: number, radius: number): { x: number; y: number } {
  let nx = x + dx;
  let ny = y + dy;
  if (!walkable(op, nx, y) || blocked(op, nx, y, radius)) nx = x;
  if (!walkable(op, x, ny) || blocked(op, nx, ny, radius)) ny = y;
  return { x: nx, y: ny };
}

function blocked(op: Operation, x: number, y: number, radius: number): boolean {
  for (const b of op.buildings) {
    if (Math.hypot(b.x - x, b.y - y) < radius + 0.42) {
      if (b.kind === 'rack' || b.kind === 'plate' || b.kind === 'chrome') return true;
    }
  }
  return false;
}

function sancientPos(op: Operation): { x: number; y: number } | null {
  const s = op.machines.find((m) => m.kind === 'sancient' && m.hp > 0);
  return s ? { x: s.x, y: s.y } : null;
}

function nnnPos(op: Operation): { x: number; y: number } | null {
  const b = op.buildings.find((x) => x.kind === 'nnn');
  return b ? { x: b.x, y: b.y } : null;
}

function chromeBubble(op: Operation, x: number, y: number): boolean {
  for (const b of op.buildings) {
    if (b.kind === 'chrome' && Math.hypot(b.x - x, b.y - y) < 4.2) return true;
  }
  return false;
}

function fireShot(op: Operation, x: number, y: number, tx: number, ty: number, dmg: number, from: Shot['from']): void {
  const d = Math.hypot(tx - x, ty - y) || 1;
  op.shots.push({
    x,
    y,
    vx: ((tx - x) / d) * (from === 'player' ? 22 : 16),
    vy: ((ty - y) / d) * (from === 'player' ? 22 : 16),
    dmg,
    from,
    life: 0.9,
  });
}

export function canAfford(stock: Stock, kind: BuildKind, op: Operation): boolean {
  const cost = BUILD_COST[kind];
  if ((cost.scrap ?? 0) > stock.scrap) return false;
  if ((cost.rack ?? 0) > stock.rack) return false;
  if ((cost.plate ?? 0) > stock.plate) return false;
  if ((cost.chrome ?? 0) > stock.chrome) return false;
  if (kind === 'nnn') {
    if (op.buildings.some((b) => b.kind === 'nnn')) return false;
    if (!op.buildings.some((b) => b.kind === 'extractor')) return false;
  }
  if (kind === 'chrome' && !op.buildings.some((b) => b.kind === 'nnn')) return false;
  if (kind === 'turret' && !op.buildings.some((b) => b.kind === 'extractor')) return false;
  if (kind === 'plate' && stock.plate < 3) return false;
  return true;
}

function placeBuilding(op: Operation, stock: Stock, kind: BuildKind, x: number, y: number): boolean {
  if (!canAfford(stock, kind, op)) return false;
  if (!walkable(op, x, y)) return false;
  const t = tileAt(op, x, y);
  if (t === 'elevator') return false;
  if (op.buildings.some((b) => Math.hypot(b.x - x, b.y - y) < 1.1)) return false;
  if (!spend(stock, BUILD_COST[kind])) return false;
  const hp = kind === 'plate' || kind === 'chrome' ? 140 : kind === 'nnn' ? 90 : 70;
  op.buildings.push({ id: op.nextId++, kind, x, y, hp, maxHp: hp });
  if (kind === 'nnn') {
    op.nnnId = op.buildings[op.buildings.length - 1].id;
    op.nnnLit = true;
    op.litEver = true;
    op.loudness = Math.min(1, op.loudness + 0.55);
    log(op, nnnLine());
    for (const m of op.machines) {
      if (m.kind !== 'sancient' && m.hp > 0) log(op, wakeLine(m.kind));
    }
  }
  if (kind === 'chrome') {
    op.loudness = 1;
    log(op, '[SkyNeet] Chrome bubble up. Untouchable in here. Easier to find.');
  }
  if (kind === 'extractor') log(op, '[SkyNeet] Works are turning. Still dark.');
  return true;
}

function harvest(op: Operation, stock: Stock): void {
  for (const w of op.wrecks) {
    if (w.scrap <= 0) continue;
    if (Math.hypot(w.x - op.player.x, w.y - op.player.y) < 1.35) {
      w.scrap -= 1;
      stock.scrap += 1;
      op.cargo += 1;
      return;
    }
  }
  for (const b of op.buildings) {
    if (b.kind !== 'extractor') continue;
    if (Math.hypot(b.x - op.player.x, b.y - op.player.y) < 1.4 && stock.scrap >= 4) {
      stock.scrap -= 4;
      stock.rack += 1;
      return;
    }
  }
}

function nearestThreat(op: Operation, x: number, y: number): { x: number; y: number } | null {
  let best: { x: number; y: number; d: number } | null = null;
  const consider = (px: number, py: number) => {
    const d = Math.hypot(px - x, py - y);
    if (!best || d < best.d) best = { x: px, y: py, d };
  };
  consider(op.player.x, op.player.y);
  const n = nnnPos(op);
  if (n && op.nnnLit) consider(n.x, n.y);
  return best;
}

function stepMachines(op: Operation, dt: number): void {
  const san = sancientPos(op);
  const windowOpen = op.sancientWindow > 0;
  for (const m of op.machines) {
    if (m.hp <= 0) continue;
    const near = !!(san && Math.hypot(m.x - san.x, m.y - san.y) < (m.kind === 'sancient' ? 0 : 9.5));
    const c = machineCompetence(m, windowOpen, near);
    const spd = moveSpeed(m.kind, c);

    if (m.kind === 'sancient') {
      m.charge -= dt * (0.35 + op.loudness * 0.8);
      if (m.charge <= 0 && op.sancientWindow <= 0 && op.loudness >= 0.45) {
        op.sancientWindow = 7.5 + op.loudness * 4;
        m.window = op.sancientWindow;
        m.charge = 10;
        log(op, sancientLine());
      }
      // Does not fight. Drifts toward loudness.
      const n = nnnPos(op);
      const tx = n ? n.x : op.player.x;
      const ty = n ? n.y : op.player.y;
      const d = Math.hypot(tx - m.x, ty - m.y) || 1;
      const pos = tryMove(op, m.x, m.y, ((tx - m.x) / d) * spd * dt, ((ty - m.y) / d) * spd * dt, 0.45);
      m.x = pos.x;
      m.y = pos.y;
      continue;
    }

    const awake = op.nnnLit || (op.biome === 'hum' && op.loudness > 0.35);
    const grace = op.time < 2.2;
    let tx = m.tx;
    let ty = m.ty;
    if (awake && !grace) {
      const t = nearestThreat(op, m.x, m.y);
      if (t) {
        tx = t.x;
        ty = t.y;
      }
    } else {
      m.wander -= dt;
      if (m.wander <= 0) {
        m.wander = 1.4 + Math.random() * 2.2;
        m.tx = m.x + (Math.random() - 0.5) * 8;
        m.ty = m.y + (Math.random() - 0.5) * 8;
      }
      tx = m.tx;
      ty = m.ty;
    }

    const d = Math.hypot(tx - m.x, ty - m.y) || 1;
    const stepLen = Math.min(spd * dt, d);
    const pos = tryMove(op, m.x, m.y, ((tx - m.x) / d) * stepLen, ((ty - m.y) / d) * stepLen, 0.4);
    m.x = pos.x;
    m.y = pos.y;

    if (m.kind === 'nobot' && !op.nnnLit) continue;
    if (grace) continue;

    const target = nearestThreat(op, m.x, m.y);
    const dist = target ? Math.hypot(target.x - m.x, target.y - m.y) : 99;
    // Fallback loop: wander. Only wild-fire if someone walks into the magazine.
    // Lit NNN: they come off fallback and acquire.
    const engage = awake ? dist < 10 + c * 3 : dist < 2.1;
    if (engage && target) {
      const bubble = chromeBubble(op, target.x, target.y) && m.neutrino;
      if (bubble && !windowOpen) {
        m.telegraph = 0;
        continue;
      }
      m.telegraph += dt;
      if (m.telegraph >= aimSeconds(c)) {
        m.telegraph = 0;
        const dmg = awake ? 6 + m.lethality * 12 : 4 + m.lethality * 6;
        if (Math.random() < hitChance(c)) {
          fireShot(op, m.x, m.y, target.x, target.y, dmg, 'machine');
        } else {
          fireShot(
            op,
            m.x,
            m.y,
            target.x + (Math.random() - 0.5) * 5,
            target.y + (Math.random() - 0.5) * 5,
            dmg,
            'machine',
          );
        }
      }
    } else {
      m.telegraph = Math.max(0, m.telegraph - dt * 0.6);
    }
  }
}

function stepShots(op: Operation, dt: number): void {
  const next: Shot[] = [];
  for (const s of op.shots) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (s.life <= 0 || !walkable(op, s.x, s.y)) continue;
    let hit = false;
    if (s.from === 'player' || s.from === 'turret') {
      for (const m of op.machines) {
        if (m.hp <= 0) continue;
        if (Math.hypot(m.x - s.x, m.y - s.y) < 0.55) {
          m.hp -= s.dmg;
          hit = true;
          if (m.hp <= 0 && m.kind === 'sancient') {
            op.sancientKilled = true;
            op.sancientWindow = 0;
            log(op, dumpLine());
          }
          break;
        }
      }
    } else {
      if (Math.hypot(op.player.x - s.x, op.player.y - s.y) < 0.42) {
        op.player.hp -= s.dmg;
        hit = true;
      } else {
        for (const b of op.buildings) {
          if (Math.hypot(b.x - s.x, b.y - s.y) < 0.5) {
            if (b.kind === 'chrome' && s.from === 'machine') break;
            b.hp -= s.dmg;
            hit = true;
            break;
          }
        }
      }
    }
    if (!hit) next.push(s);
  }
  op.shots = next;
  op.buildings = op.buildings.filter((b) => {
    if (b.hp > 0) return true;
    if (b.kind === 'nnn') {
      op.nnnLit = false;
      log(op, '[SkyNeet] Node down. Fallback resumes.');
    }
    return false;
  });
}

function stepExtractors(op: Operation, stock: Stock, dt: number): void {
  const mult = op.nnnLit ? 4.2 : 1;
  for (const b of op.buildings) {
    if (b.kind !== 'extractor') continue;
    for (const w of op.wrecks) {
      if (w.scrap <= 0) continue;
      if (Math.hypot(w.x - b.x, w.y - b.y) < 5) {
        const take = Math.min(w.scrap, dt * 0.7 * mult);
        w.scrap -= take;
        stock.scrap += take;
        op.cargo += take * 0.35;
        break;
      }
    }
  }
  for (const b of op.buildings) {
    if (b.kind !== 'turret') continue;
    let best: Machine | null = null;
    let bd = 8;
    for (const m of op.machines) {
      if (m.hp <= 0) continue;
      const d = Math.hypot(m.x - b.x, m.y - b.y);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (best && Math.random() < dt * 1.6) fireShot(op, b.x, b.y, best.x, best.y, 8, 'turret');
  }
}

export function jackSancient(op: Operation): boolean {
  const s = op.machines.find((m) => m.kind === 'sancient' && m.hp > 0);
  if (!s) return false;
  if (Math.hypot(s.x - op.player.x, s.y - op.player.y) > 1.3) return false;
  s.hp = 0;
  op.jacked = true;
  op.sancientWindow = 0;
  log(op, '[SkyNeet] Cache jacked. Fragment, not the unit. Swarm dumped.');
  return true;
}

export function step(op: Operation, stock: Stock, input: FrameInput, dt: number): void {
  if (op.result !== 'running') return;
  const clamped = Math.max(0.001, Math.min(0.05, dt));
  op.time += clamped;
  if (op.sancientWindow > 0) {
    op.sancientWindow -= clamped;
    if (op.sancientWindow <= 0) {
      op.sancientWindow = 0;
      log(op, dumpLine());
    }
  }

  let ax = input.ax;
  let ay = input.ay;
  const mag = Math.hypot(ax, ay);
  if (mag > 1) {
    ax /= mag;
    ay /= mag;
  }
  const wet = tileAt(op, op.player.x, op.player.y) === 'water' ? 0.55 : 1;
  const pos = tryMove(op, op.player.x, op.player.y, ax * PLAYER_SPEED * wet * clamped, ay * PLAYER_SPEED * wet * clamped, 0.28);
  op.player.x = pos.x;
  op.player.y = pos.y;
  op.player.fireCd = Math.max(0, op.player.fireCd - clamped);

  if (input.fire && op.player.fireCd <= 0) {
    fireShot(op, op.player.x, op.player.y, input.wx, input.wy, NEEDLER_DMG, 'player');
    op.player.fireCd = NEEDLER_CD;
  }
  if (input.place && input.build) placeBuilding(op, stock, input.build, input.wx, input.wy);
  if (input.interact) {
    if (!jackSancient(op)) harvest(op, stock);
  }
  if (input.leave && tileAt(op, op.player.x, op.player.y) === 'elevator') {
    if (op.cargo >= op.quota * 0.45 || op.biome === 'trunk') {
      op.result = 'extracted';
      log(op, extractLine(!op.litEver));
    } else {
      log(op, '[SkyNeet] Quota is light. Leave anyway if you want. The hole will keep the rest.');
      op.result = 'extracted';
    }
  }

  stepMachines(op, clamped);
  stepExtractors(op, stock, clamped);
  stepShots(op, clamped);

  if (op.player.hp <= 0) {
    op.player.hp = 0;
    op.result = 'dead';
    log(op, deathLine());
  }
}

export function finish(op: Operation): OpResult {
  const haul: Stock = {
    scrap: 0,
    rack: 0,
    plate: 0,
    chrome: 0,
    fragments: 0,
  };
  return {
    siteId: op.siteId,
    outcome: op.result === 'running' ? 'abandoned' : op.result,
    haul,
    lit: op.litEver,
    ghost: op.result === 'extracted' && !op.litEver,
    jacked: op.jacked,
    sancientKilled: op.sancientKilled,
    duration: op.time,
  };
}

export function buildingUnlocked(kind: BuildKind, op: Operation, stock: Stock): boolean {
  if (kind === 'nnn') return op.buildings.some((b) => b.kind === 'extractor') && stock.scrap >= 12;
  if (kind === 'chrome') return stock.chrome > 0 && op.buildings.some((b) => b.kind === 'nnn');
  if (kind === 'plate') return stock.plate > 0;
  if (kind === 'turret') return op.buildings.some((b) => b.kind === 'extractor') || stock.rack >= 6;
  return true;
}
