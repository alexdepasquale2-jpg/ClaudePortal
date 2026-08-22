/**
 * ritual.ts — the reset ceremonies, plus the small audio and haptic engine
 * the rest of the UI borrows.
 *
 * Three tiers, three distinct rituals. A player must never be unsure which
 * one just happened, so they differ in length, palette, geometry and chord —
 * not merely in the text on top.
 *
 * All of it degrades to an instant state change under reduced motion: the
 * overlay still appears and still announces the result, it just does not
 * animate. That is the accessible behaviour, not a lesser one.
 */

import { accentRgb } from './palette';

export type RitualKind = 'collapse' | 'epoch' | 'genesis';

export interface RitualSpec {
  durationMs: number;
  particles: number;
  hues: number[];
  chord: number[];
  haptics: number[];
  title: string;
}

export const RITUALS: Record<RitualKind, RitualSpec> = {
  collapse: {
    durationMs: 2200,
    particles: 320,
    hues: [190, 205, 220],
    chord: [196, 261.63, 329.63, 392],
    haptics: [40, 60, 40, 60, 120],
    title: 'COLLAPSE',
  },
  epoch: {
    durationMs: 4200,
    particles: 900,
    hues: [280, 310, 340, 20],
    chord: [130.81, 164.81, 196, 246.94, 329.63],
    haptics: [80, 40, 80, 40, 160, 60, 240],
    title: 'EPOCH',
  },
  genesis: {
    durationMs: 6400,
    particles: 1600,
    hues: [45, 60, 15, 340, 200],
    chord: [65.41, 98, 130.81, 196, 261.63, 392, 523.25],
    haptics: [120, 60, 120, 60, 200, 80, 200, 80, 400],
    title: 'GENESIS',
  },
};

// ---------------------------------------------------------------------------
// audio
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof AudioContext === 'undefined' && typeof (globalThis as any).webkitAudioContext === 'undefined') {
    return null;
  }
  if (!audioCtx) {
    const Ctor = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  const ac = audioCtx;
  if (!ac) return null;
  if (ac.state === 'suspended') void ac.resume();
  return ac;
}

/** Browsers require a gesture before audio; call this from the first click. */
export function unlockAudio(): void {
  ctx();
}

export function blip(freq: number, enabled: boolean, gain = 0.05, ms = 70): void {
  if (!enabled) return;
  const ac = ctx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, ac.currentTime);
  g.gain.linearRampToValueAtTime(gain, ac.currentTime + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms / 1000);
  osc.connect(g).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + ms / 1000 + 0.02);
}

export function chord(freqs: number[], enabled: boolean, seconds: number): void {
  if (!enabled) return;
  const ac = ctx();
  if (!ac) return;
  const now = ac.currentTime;
  const master = ac.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.16, now + 0.12);
  master.gain.setValueAtTime(0.16, now + seconds * 0.55);
  master.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
  master.connect(ac.destination);

  freqs.forEach((f, i) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = i % 2 === 0 ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(f, now);
    // a slow upward drift makes the longer rituals feel like they are climbing
    osc.frequency.linearRampToValueAtTime(f * 1.02, now + seconds);
    g.gain.value = 1 / (freqs.length + i * 0.5);
    osc.connect(g).connect(master);
    osc.start(now + i * 0.06);
    osc.stop(now + seconds + 0.05);
  });
}

export function haptic(pattern: number[], enabled: boolean): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* vibration is a nicety */
  }
}

// ---------------------------------------------------------------------------
// the overlay
// ---------------------------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
  size: number;
}

export interface RitualOptions {
  reducedMotion: boolean;
  sound: boolean;
  haptics: boolean;
  headline: string;
  detail: string;
}

/**
 * Play a ritual. Resolves when the ceremony is over (immediately, under
 * reduced motion, after the player has had a moment to read it).
 */
export function playRitual(
  host: HTMLElement,
  kind: RitualKind,
  opts: RitualOptions,
): Promise<void> {
  const spec = RITUALS[kind];
  const overlay = document.createElement('div');
  overlay.className = `ritual ritual-${kind}`;
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-live', 'assertive');
  overlay.innerHTML =
    '<canvas class="ritual-canvas"></canvas>' +
    '<div class="ritual-text">' +
    `<div class="ritual-kind">${spec.title}</div>` +
    `<div class="ritual-headline"></div>` +
    `<div class="ritual-detail"></div>` +
    '<button class="ritual-dismiss">Continue</button>' +
    '</div>';
  (overlay.querySelector('.ritual-headline') as HTMLElement).textContent = opts.headline;
  (overlay.querySelector('.ritual-detail') as HTMLElement).textContent = opts.detail;
  host.appendChild(overlay);

  chord(spec.chord, opts.sound, spec.durationMs / 1000);
  haptic(spec.haptics, opts.haptics);

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      overlay.classList.add('is-leaving');
      setTimeout(() => overlay.remove(), opts.reducedMotion ? 0 : 320);
      resolve();
    };

    overlay.querySelector('.ritual-dismiss')!.addEventListener('click', finish);
    const timer = setTimeout(finish, spec.durationMs);
    overlay.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') {
        clearTimeout(timer);
        finish();
      }
    });
    (overlay.querySelector('.ritual-dismiss') as HTMLElement).focus();

    if (opts.reducedMotion) {
      // No particles, no animation. The overlay is still shown and still
      // announced; the state change has already happened either way.
      (overlay.querySelector('.ritual-canvas') as HTMLElement).style.display = 'none';
      return;
    }

    const canvas = overlay.querySelector('.ritual-canvas') as HTMLCanvasElement;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const resize = (): void => {
      canvas.width = Math.round(overlay.clientWidth * dpr);
      canvas.height = Math.round(overlay.clientHeight * dpr);
    };
    resize();
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    const parts: Particle[] = [];
    for (let i = 0; i < spec.particles; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (0.6 + Math.random() * 3.4) * (kind === 'collapse' ? 1 : 1.5) * dpr;
      parts.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0.5 + Math.random() * 0.5,
        hue: spec.hues[i % spec.hues.length],
        size: (0.6 + Math.random() * 2.4) * dpr,
      });
    }

    const start = performance.now();
    const frame = (now: number): void => {
      const t = (now - start) / spec.durationMs;
      if (t >= 1 || done) {
        ctx2d.clearRect(0, 0, w, h);
        return;
      }
      ctx2d.fillStyle = 'rgba(6 7 11 / 0.22)';
      ctx2d.fillRect(0, 0, w, h);

      // Epoch and Genesis add rotating rings: the rules themselves turning.
      if (kind !== 'collapse') {
        const rings = kind === 'genesis' ? 7 : 4;
        for (let i = 0; i < rings; i++) {
          const c = accentRgb(spec.hues[i % spec.hues.length]);
          const r = (0.12 + i * 0.11) * Math.min(w, h) * (0.6 + t * 1.4);
          ctx2d.strokeStyle = `rgba(${c.r} ${c.g} ${c.b} / ${(0.5 * (1 - t)).toFixed(3)})`;
          ctx2d.lineWidth = 2 * dpr;
          ctx2d.beginPath();
          const spin = now / 900 + i;
          ctx2d.arc(cx, cy, r, spin, spin + Math.PI * 1.35);
          ctx2d.stroke();
        }
      }

      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.991;
        p.vy = p.vy * 0.991 + 0.02 * dpr;
        const c = accentRgb(p.hue);
        const alpha = Math.max(0, p.life * (1 - t));
        ctx2d.fillStyle = `rgba(${c.r} ${c.g} ${c.b} / ${alpha.toFixed(3)})`;
        ctx2d.fillRect(p.x, p.y, p.size, p.size);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/** Does the player want motion? Setting wins; 'auto' asks the OS. */
export function prefersReducedMotion(pref: 'auto' | 'full' | 'reduced'): boolean {
  if (pref === 'reduced') return true;
  if (pref === 'full') return false;
  return (
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
