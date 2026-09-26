import type { PartKind } from '../engine/types';

export const INK = {
  night: '#07060a',
  dusk: '#120f18',
  floor: '#1a1520',
  bone: '#efe6d6',
  mute: '#9a8f86',
  warm: '#ffcf8a',
  ember: '#ff9e5e',
  honey: '#e8b25a',
  sea: '#7cc7d9',
  moss: '#9fcf8c',
  plum: '#b58ad6',
  gold: '#d9b44a',
  rust: '#c9644a',
  steel: '#8d96a3',
};

/**
 * Parts are drawn, not iconified: a few strokes each, in warm light for true
 * parts and a harder, colder line for vain ones. `s` is the half-size.
 */
export function drawPart(
  ctx: CanvasRenderingContext2D,
  kind: PartKind,
  x: number,
  y: number,
  s: number,
  rot: number,
  alpha: number,
  t: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, s * 0.14);
  switch (kind) {
    case 'table': {
      ctx.strokeStyle = INK.honey;
      ctx.beginPath();
      ctx.moveTo(-s, -s * 0.2);
      ctx.lineTo(s, -s * 0.2);
      ctx.moveTo(-s * 0.75, -s * 0.2);
      ctx.lineTo(-s * 0.75, s * 0.8);
      ctx.moveTo(s * 0.75, -s * 0.2);
      ctx.lineTo(s * 0.75, s * 0.8);
      ctx.stroke();
      break;
    }
    case 'lamp': {
      const flick = 1 + Math.sin(t * 9 + x) * 0.08 + Math.sin(t * 13.7) * 0.05;
      const g = ctx.createRadialGradient(0, -s * 0.45, 0, 0, -s * 0.45, s * 1.6);
      g.addColorStop(0, 'rgba(255,207,138,0.45)');
      g.addColorStop(1, 'rgba(255,207,138,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -s * 0.45, s * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK.warm;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.5, s * 0.22, s * 0.42 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK.honey;
      ctx.beginPath();
      ctx.moveTo(-s * 0.55, 0);
      ctx.quadraticCurveTo(0, s * 0.55, s * 0.55, 0);
      ctx.moveTo(0, s * 0.3);
      ctx.lineTo(0, s * 0.85);
      ctx.moveTo(-s * 0.35, s * 0.85);
      ctx.lineTo(s * 0.35, s * 0.85);
      ctx.stroke();
      break;
    }
    case 'loaf': {
      ctx.fillStyle = '#c98f4f';
      ctx.strokeStyle = '#f0c68a';
      ctx.beginPath();
      ctx.moveTo(-s, s * 0.45);
      ctx.bezierCurveTo(-s, -s * 0.7, s, -s * 0.7, s, s * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(i * s * 0.45 - s * 0.12, -s * 0.05);
        ctx.lineTo(i * s * 0.45 + s * 0.12, -s * 0.3);
      }
      ctx.stroke();
      break;
    }
    case 'shore': {
      ctx.strokeStyle = INK.sea;
      ctx.beginPath();
      for (let row = 0; row < 3; row++) {
        const yy = -s * 0.4 + row * s * 0.4;
        for (let i = 0; i <= 12; i++) {
          const xx = -s + (i / 12) * 2 * s;
          const w = Math.sin(i * 1.1 + t * 1.6 + row) * s * 0.1;
          if (i === 0) ctx.moveTo(xx, yy + w);
          else ctx.lineTo(xx, yy + w);
        }
      }
      ctx.stroke();
      ctx.strokeStyle = '#d8c79a';
      ctx.beginPath();
      ctx.moveTo(-s, s * 0.8);
      ctx.lineTo(s, s * 0.8);
      ctx.stroke();
      break;
    }
    case 'door': {
      ctx.strokeStyle = INK.bone;
      ctx.beginPath();
      ctx.moveTo(-s * 0.6, s);
      ctx.lineTo(-s * 0.6, -s * 0.4);
      ctx.arc(0, -s * 0.4, s * 0.6, Math.PI, 0);
      ctx.lineTo(s * 0.6, s);
      ctx.stroke();
      // the leaf stands ajar: it can close, and it opens
      const ajar = 0.35 + Math.sin(t * 0.7) * 0.08;
      ctx.fillStyle = 'rgba(255,207,138,0.25)';
      ctx.beginPath();
      ctx.moveTo(-s * 0.6, s);
      ctx.lineTo(-s * 0.6, -s * 0.4);
      ctx.lineTo(-s * 0.6 + s * 1.2 * (1 - ajar), -s * 0.3);
      ctx.lineTo(-s * 0.6 + s * 1.2 * (1 - ajar), s);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'bed': {
      ctx.strokeStyle = INK.plum;
      ctx.beginPath();
      ctx.moveTo(-s, -s * 0.3);
      ctx.lineTo(-s, s * 0.6);
      ctx.moveTo(-s, s * 0.25);
      ctx.lineTo(s, s * 0.25);
      ctx.lineTo(s, s * 0.6);
      ctx.stroke();
      ctx.fillStyle = 'rgba(181,138,214,0.5)';
      ctx.beginPath();
      ctx.ellipse(-s * 0.55, s * 0.05, s * 0.32, s * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'crown': {
      ctx.strokeStyle = INK.gold;
      ctx.beginPath();
      ctx.moveTo(-s, s * 0.5);
      ctx.lineTo(-s, -s * 0.6);
      ctx.lineTo(-s * 0.5, 0);
      ctx.lineTo(0, -s * 0.8);
      ctx.lineTo(s * 0.5, 0);
      ctx.lineTo(s, -s * 0.6);
      ctx.lineTo(s, s * 0.5);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'coin': {
      ctx.strokeStyle = INK.steel;
      ctx.strokeRect(-s * 0.7, -s * 0.7, s * 1.4, s * 1.4);
      ctx.lineWidth *= 1.6;
      ctx.beginPath();
      ctx.moveTo(-s * 0.35, 0);
      ctx.lineTo(s * 0.35, 0);
      ctx.stroke();
      break;
    }
    case 'mirror': {
      ctx.strokeStyle = INK.steel;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.1, s * 0.55, s * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(220,230,240,0.5)';
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, -s * 0.5);
      ctx.lineTo(s * 0.15, -s * 0.1);
      ctx.stroke();
      break;
    }
    case 'lock': {
      ctx.strokeStyle = INK.rust;
      ctx.beginPath();
      ctx.arc(0, -s * 0.2, s * 0.45, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = INK.rust;
      ctx.fillRect(-s * 0.7, -s * 0.2, s * 1.4, s);
      ctx.fillStyle = INK.night;
      ctx.beginPath();
      ctx.arc(0, s * 0.25, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
