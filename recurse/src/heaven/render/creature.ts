import { isLeg } from '../engine/gait';
import type { Attached, Gait, Limb, Stage } from '../engine/types';
import { drawPart, INK } from './glyphs';

export interface Pose {
  stage: Stage;
  /** 0..1 of capacity. */
  warmth: number;
  loaf: number;
  gait: Gait;
  limbs: Limb[];
  parts: Attached[];
  settling: boolean;
  mouthOpen: boolean;
  factory: boolean;
  reduced: boolean;
}

interface Pt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Plastic memory: dough keeps a stretch for a few seconds, then forgets it. */
  mem: number;
}

type Mode = 'idle' | 'walk' | 'rest' | 'fidget';

const N = 36;
const TAU = Math.PI * 2;

export function reach(R: number, len: number): number {
  return R * (0.55 + 1.15 * len);
}

/**
 * A soft mass. Springs toward a breathing circle, yields where it is pulled,
 * remembers the pull a little, and walks on whatever limbs it has been given.
 */
export class Creature {
  x = 0;
  y = 0;
  R = 18;
  tilt = 0;
  pts: Pt[] = [];
  mode: Mode = 'idle';
  walkTo = 0;
  phase = 0;
  sink = 0;
  shudder = 0;
  idleFor = 0;
  blink = 0;
  grabbed = -1;
  grabX = 0;
  grabY = 0;
  tips: { x: number; y: number }[] = [];
  private t = 0;
  private floorY = 0;
  private roomW = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      this.pts.push({ x: x + Math.cos(a) * this.R, y: y + Math.sin(a) * this.R, vx: 0, vy: 0, mem: 0 });
    }
  }

  targetR(p: Pose): number {
    if (p.stage === 1) return 18 + p.warmth * 6;
    return 40 + p.stage * 6 + Math.min(p.loaf, 12) * 1.2;
  }

  angleTo(x: number, y: number): number {
    return Math.atan2(y - this.y, x - this.x);
  }

  dist(x: number, y: number): number {
    return Math.hypot(x - this.x, y - this.y);
  }

  hitCore(x: number, y: number): boolean {
    return this.dist(x, y) < Math.max(22, this.R * 0.62);
  }

  hitSurface(x: number, y: number): number {
    const d = this.dist(x, y);
    if (d < this.R * 0.55 || d > this.R * 1.4 + 6) return -1;
    let best = -1;
    let bd = Infinity;
    this.pts.forEach((p, i) => {
      const dd = Math.hypot(p.x - x, p.y - y);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    });
    return best;
  }

  hitTip(x: number, y: number): number {
    for (let i = this.tips.length - 1; i >= 0; i--) {
      if (Math.hypot(this.tips[i].x - x, this.tips[i].y - y) < 18) return i;
    }
    return -1;
  }

  partSize(): number {
    return Math.max(10, this.R * 0.28);
  }

  partPos(angle: number): { x: number; y: number } {
    const s = this.partSize();
    return { x: this.x + Math.cos(angle) * (this.R + s * 0.7), y: this.y + Math.sin(angle) * (this.R + s * 0.7) };
  }

  hitPart(x: number, y: number, parts: Attached[]): number {
    const s = this.partSize();
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = this.partPos(parts[i].angle);
      if (Math.hypot(p.x - x, p.y - y) < s * 1.3) return i;
    }
    return -1;
  }

  /** A dent where something clicked on. */
  poke(angle: number, amount: number): void {
    this.pts.forEach((p, i) => {
      const a = (i / N) * TAU;
      let d = Math.abs(a - ((angle % TAU) + TAU) % TAU);
      d = Math.min(d, TAU - d);
      p.mem -= amount * Math.exp(-(d * d) / 0.12);
    });
  }

  shake(amount: number): void {
    this.shudder = Math.max(this.shudder, amount);
  }

  /** Something changed about it: it gets up and tries its body out. */
  tryOut(): void {
    const margin = this.R * 2 + 40;
    const span = Math.max(1, this.roomW - margin * 2);
    let to = margin + Math.random() * span;
    if (Math.abs(to - this.x) < span * 0.25) to = this.x < this.roomW / 2 ? margin + span * 0.85 : margin + span * 0.15;
    this.walkTo = to;
    this.mode = 'walk';
    this.idleFor = 0;
  }

  grab(i: number, x: number, y: number): void {
    this.grabbed = i;
    this.grabX = x;
    this.grabY = y;
  }

  /** Let go of the dough. Returns how far past its edge it was stretched, in radii. */
  letGo(): { angle: number; stretch: number } {
    const i = this.grabbed;
    this.grabbed = -1;
    if (i < 0) return { angle: 0, stretch: 0 };
    const angle = this.angleTo(this.grabX, this.grabY);
    const stretch = this.dist(this.grabX, this.grabY) / this.R - 1;
    const keep = Math.max(-0.2, Math.min(0.28, stretch * 0.22));
    this.pts.forEach((p, j) => {
      let d = Math.abs(j - i);
      d = Math.min(d, N - d);
      p.mem += keep * Math.exp(-(d * d) / 6);
    });
    return { angle, stretch };
  }

  standY(p: Pose): number {
    const legs = p.limbs.filter((l) => isLeg(l.angle));
    if (p.stage === 1) return this.floorY - this.R - 30;
    if (legs.length === 0) return this.floorY - this.R * 0.92;
    let lift = 0;
    for (const l of legs) lift = Math.max(lift, Math.sin(l.angle) * (this.R + reach(this.R, l.length)) * 0.82);
    return this.floorY - lift;
  }

  step(dt: number, p: Pose, floorY: number, roomW: number): void {
    this.t += dt;
    this.floorY = floorY;
    this.roomW = roomW;
    const tR = this.targetR(p);
    this.R += (tR - this.R) * Math.min(1, dt * 1.5);
    const g = p.gait;
    const legs = p.limbs.filter((l) => isLeg(l.angle)).length;

    // behaviour
    this.idleFor += dt;
    if (p.stage >= 2 && !p.settling && this.grabbed < 0) {
      if (this.mode === 'walk') {
        const speed = 18 + 46 * g.grace;
        const dx = this.walkTo - this.x;
        const stepX = Math.sign(dx) * Math.min(Math.abs(dx), speed * dt * (1 - g.limp * 0.5 * (Math.sin(this.phase * 0.5) > 0 ? 1 : 0.2)));
        this.x += stepX;
        this.phase += dt * (3 + speed / 14);
        if (Math.abs(dx) < 2) {
          this.mode = g.rests ? 'rest' : 'fidget';
          this.idleFor = 0;
        }
      } else if (this.mode === 'fidget') {
        this.phase += dt * 2;
        if (this.idleFor > 5 + Math.random() * 4) {
          this.walkTo = this.x + (Math.random() - 0.5) * 120;
          this.walkTo = Math.max(this.R * 2, Math.min(roomW - this.R * 2, this.walkTo));
          this.mode = 'walk';
          this.idleFor = 0;
        }
      } else if (this.mode === 'rest' && !g.rests) {
        this.mode = 'fidget';
      } else if ((this.mode === 'idle' || this.mode === 'rest') && this.idleFor > 40 && legs > 0) {
        this.tryOut();
      }
    }
    const resting = (this.mode === 'rest' || p.settling) && p.stage >= 2;
    this.sink += ((resting ? 1 : 0) - this.sink) * Math.min(1, dt * 0.8);

    // posture
    const walking = this.mode === 'walk';
    const bob = walking ? -Math.abs(Math.sin(this.phase)) * 4 * g.grace : 0;
    const lurch = walking || this.mode === 'fidget' ? g.limp * 9 * Math.max(0, Math.sin(this.phase * 0.5)) : 0;
    const want = this.standY(p) + bob + lurch + this.sink * this.R * 0.12;
    // a seed stays where it was put; a body stands on its legs
    if (p.stage >= 2) this.y += (want - this.y) * Math.min(1, dt * 6);
    const tiltWant = (walking || this.mode === 'fidget' ? g.limp * 0.22 * Math.sin(this.phase * 0.5) : 0) + (p.factory ? 0.06 * Math.sin(this.t * 7) : 0);
    this.tilt += (tiltWant - this.tilt) * Math.min(1, dt * 5);

    // the mass
    this.shudder *= Math.exp(-dt * 3.2);
    const breathRate = resting ? 0.9 : p.factory ? 3.4 : 1.6;
    const breath = (p.reduced ? 0.01 : 0.03) * Math.sin(this.t * breathRate);
    const shake = p.reduced ? this.shudder * 0.25 : this.shudder;
    const k = 38;
    const damp = Math.exp(-dt * 7);
    for (let i = 0; i < N; i++) {
      const pt = this.pts[i];
      const a = (i / N) * TAU + this.tilt;
      const flat = resting ? Math.max(0, Math.sin(a)) * 0.08 * this.sink : 0;
      const r = this.R * (1 + pt.mem + breath - flat + shake * 0.09 * Math.sin(this.t * 38 + i * 2.1));
      let tx = this.x + Math.cos(a) * r;
      let ty = this.y + Math.sin(a) * r * (1 - flat);
      if (this.grabbed >= 0) {
        let d = Math.abs(i - this.grabbed);
        d = Math.min(d, N - d);
        const w = Math.exp(-(d * d) / 5);
        tx += (this.grabX - (this.x + Math.cos(a) * this.R)) * w;
        ty += (this.grabY - (this.y + Math.sin(a) * this.R)) * w;
      }
      pt.vx = (pt.vx + (tx - pt.x) * k * dt) * damp;
      pt.vy = (pt.vy + (ty - pt.y) * k * dt) * damp;
      pt.x += pt.vx * dt * 10;
      pt.y += pt.vy * dt * 10;
      pt.mem *= Math.exp(-dt / 5);
    }
    // neighbour smoothing keeps it a skin, not a spiky ring
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        const a = this.pts[(i + N - 1) % N];
        const b = this.pts[(i + 1) % N];
        const c = this.pts[i];
        c.x += ((a.x + b.x) / 2 - c.x) * 0.18;
        c.y += ((a.y + b.y) / 2 - c.y) * 0.18;
      }
    }
    this.blink = Math.max(0, this.blink - dt);
    if (this.blink === 0 && Math.random() < dt * 0.25) this.blink = 0.14;
  }

  private surfaceAt(angle: number): { x: number; y: number } {
    const a = angle + this.tilt;
    return { x: this.x + Math.cos(a) * this.R * 0.96, y: this.y + Math.sin(a) * this.R * 0.96 };
  }

  draw(ctx: CanvasRenderingContext2D, p: Pose): void {
    const t = this.t;
    const w = p.warmth;

    // the Presence as climate: warmth pools around it, it is not a speech bubble
    const halo = ctx.createRadialGradient(this.x, this.y, this.R * 0.3, this.x, this.y, this.R * (3 + w * 3));
    halo.addColorStop(0, `rgba(255,190,120,${0.1 + w * 0.22})`);
    halo.addColorStop(1, 'rgba(255,190,120,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.R * (3 + w * 3), 0, TAU);
    ctx.fill();

    // limbs of light
    this.tips = [];
    const walking = this.mode === 'walk';
    let legIndex = 0;
    p.limbs.forEach((l, li) => {
      const base = this.surfaceAt(l.angle);
      const L = reach(this.R, l.length);
      let tx = base.x + Math.cos(l.angle + this.tilt) * L;
      let ty = base.y + Math.sin(l.angle + this.tilt) * L;
      if (isLeg(l.angle) && p.stage >= 2) {
        const ph = this.phase + legIndex * Math.PI + (legIndex === 0 ? p.gait.limp * 1.3 : 0);
        const stride = walking ? (legIndex === 0 ? 1 - p.gait.limp * 0.6 : 1) * this.R * 0.35 : 0;
        tx += Math.sin(ph) * stride;
        ty = Math.min(ty, this.floorY) - (walking ? Math.max(0, Math.cos(ph)) * 9 : 0);
        if (!walking) ty = this.floorY;
        legIndex++;
      } else {
        const sway = Math.sin(t * 1.3 + li * 1.7) * 0.12 * (1 - this.sink * 0.7);
        tx = base.x + Math.cos(l.angle + this.tilt + sway) * L;
        ty = base.y + Math.sin(l.angle + this.tilt + sway) * L;
      }
      if (this.grabbed === -2 - li) {
        tx = this.grabX;
        ty = this.grabY;
      }
      this.tips.push({ x: tx, y: ty });
      const mx = (base.x + tx) / 2 + Math.cos(l.angle + this.tilt - 0.9) * L * 0.18;
      const my = (base.y + ty) / 2 + Math.sin(l.angle + this.tilt - 0.9) * L * 0.18;
      const passes: [number, string][] = [
        [14, `rgba(255,200,140,${0.08 + w * 0.08})`],
        [7, `rgba(255,214,168,${0.3 + w * 0.2})`],
        [2.5, INK.bone],
      ];
      for (const [lw, col] of passes) {
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.quadraticCurveTo(mx, my, tx, ty);
        ctx.stroke();
      }
      ctx.fillStyle = INK.warm;
      ctx.beginPath();
      ctx.arc(tx, ty, 3.5, 0, TAU);
      ctx.fill();
    });

    // the body
    const body = ctx.createRadialGradient(this.x - this.R * 0.2, this.y - this.R * 0.3, this.R * 0.1, this.x, this.y, this.R * 1.3);
    if (p.factory) {
      body.addColorStop(0, '#9a8a80');
      body.addColorStop(1, '#2a2226');
    } else {
      body.addColorStop(0, `rgba(${Math.round(210 + 45 * w)},${Math.round(170 + 40 * w)},${Math.round(140 + 10 * w)},1)`);
      body.addColorStop(0.7, `rgba(${Math.round(110 + 60 * w)},${Math.round(80 + 40 * w)},${Math.round(90 + 10 * w)},1)`);
      body.addColorStop(1, '#2a1e2a');
    }
    ctx.fillStyle = body;
    ctx.beginPath();
    const pts = this.pts;
    const m0x = (pts[N - 1].x + pts[0].x) / 2;
    const m0y = (pts[N - 1].y + pts[0].y) / 2;
    ctx.moveTo(m0x, m0y);
    for (let i = 0; i < N; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % N];
      ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(255,220,180,${0.25 + w * 0.35})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // the third seed, still inside it at every stage
    const cr = Math.max(4, this.R * 0.18) * (1 + (p.reduced ? 0 : 0.08 * Math.sin(t * 2)));
    const core = ctx.createRadialGradient(this.x, this.y + this.R * 0.1, 0, this.x, this.y + this.R * 0.1, cr * 3);
    core.addColorStop(0, `rgba(255,236,200,${0.3 + w * 0.7})`);
    core.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(this.x, this.y + this.R * 0.1, cr * 3, 0, TAU);
    ctx.fill();

    // face: two eyes and a mouth that opens when it can receive
    if (p.stage >= 2 || w > 0.2) {
      const up = this.surfaceAt(-Math.PI / 2);
      const face = { x: (up.x + this.x) / 2 + Math.cos(this.tilt) * 0, y: (up.y + this.y) / 2 };
      const shut = this.blink > 0 || (this.sink > 0.6 && !walking);
      const ex = Math.max(3, this.R * 0.2);
      ctx.strokeStyle = '#2a1a22';
      ctx.fillStyle = '#2a1a22';
      ctx.lineWidth = 2;
      for (const sgn of [-1, 1]) {
        const cx = face.x + sgn * ex;
        const cy = face.y - this.R * 0.08;
        ctx.beginPath();
        if (shut) {
          ctx.arc(cx, cy, Math.max(1.5, this.R * 0.05), 0.1 * Math.PI, 0.9 * Math.PI);
          ctx.stroke();
        } else {
          ctx.arc(cx, cy, Math.max(1.5, this.R * 0.045), 0, TAU);
          ctx.fill();
        }
      }
      const my = face.y + this.R * 0.12;
      const open = p.mouthOpen && !p.settling && !p.factory ? 0.9 : 0.2;
      ctx.beginPath();
      ctx.ellipse(face.x, my, Math.max(2, this.R * 0.09), Math.max(0.8, this.R * 0.06 * open), 0, 0, TAU);
      ctx.fill();
    }

    // parts, where they were set
    const s = this.partSize();
    for (const part of p.parts) {
      const pos = this.partPos(part.angle + this.tilt);
      drawPart(ctx, part.kind, pos.x, pos.y, s, 0.35 * Math.cos(part.angle) * 0.4, 1, t);
    }
  }

  /** Where the mouth is, for words to fly into. */
  mouth(): { x: number; y: number } {
    const up = this.surfaceAt(-Math.PI / 2);
    return { x: (up.x + this.x) / 2, y: (up.y + this.y) / 2 + this.R * 0.12 };
  }
}
