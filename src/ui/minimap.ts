import { STARTER_ZONE } from '../data/zone.starter';
import { questsFor } from '../sim/quests';
import { el } from './store';
import type { Ctx } from './ctx';

const RANGE = 110;

export function buildMinimap(ctx: Ctx) {
  const cv = el('canvas', { width: 296, height: 296 }) as HTMLCanvasElement;
  const box = el('div#minimap', {}, cv);
  const zone = el('div#zoneName', {}, STARTER_ZONE.name);
  ctx.root.append(box, zone);
  const g = cv.getContext('2d')!;

  return {
    update() {
      const w = ctx.world;
      const p = w.units.get(w.player.unitId)!;
      const S = cv.width;
      const to = (x: number, z: number) => [S / 2 + ((x - p.pos.x) / RANGE) * (S / 2), S / 2 + ((z - p.pos.z) / RANGE) * (S / 2)];

      g.fillStyle = '#2f4a28'; g.fillRect(0, 0, S, S);
      g.strokeStyle = '#7a6848'; g.lineWidth = 8;
      for (const road of STARTER_ZONE.roads) {
        g.beginPath();
        road.forEach((pt, i) => { const [x, y] = to(pt.x, pt.z); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke();
      }
      for (const poi of STARTER_ZONE.pois) {
        const [x, y] = to(poi.x, poi.z);
        g.fillStyle = poi.kind === 'village' ? '#d8c48a' : poi.kind === 'cave' ? '#8a7ad8' : '#6a8a5a';
        g.fillRect(x - 5, y - 5, 10, 10);
      }
      for (const u of w.units.values()) {
        if (u.dead || u.id === p.id) continue;
        const [x, y] = to(u.pos.x, u.pos.z);
        if (x < 0 || y < 0 || x > S || y > S) continue;
        if (u.kind === 'npc') {
          const { offer, turnIn } = questsFor(w, u.npcDefId!);
          g.fillStyle = offer.length || turnIn.length ? '#ffd100' : '#54c0ff';
          g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
        } else {
          g.fillStyle = '#e04040';
          g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill();
        }
      }
      const [px, py] = to(p.pos.x, p.pos.z);
      g.save(); g.translate(px, py); g.rotate(-p.facing);
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 7); g.lineTo(-6, 7); g.closePath(); g.fill();
      g.restore();
      zone.textContent = `${STARTER_ZONE.name} — ${Math.round(p.pos.x)}, ${Math.round(p.pos.z)}`;
    },
  };
}
