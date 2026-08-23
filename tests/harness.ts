import { createWorld } from '../src/sim/world';
import { tick } from '../src/sim/tick';
import type { Command } from '../src/net/protocol';
import type { World } from '../src/sim/types';

/** Deterministic scripted run: same seed + same command script ⇒ same log, every time. */
export function runScript(seed: number, classId: string, ticks: number, script: (w: World, t: number) => Command[]): World {
  const w = createWorld(seed, classId, 'Tester');
  for (let t = 0; t < ticks; t++) tick(w, script(w, t));
  return w;
}

export function nearestMob(w: World, mobId: string) {
  const p = w.units.get(w.player.unitId)!;
  let best = null as null | { id: number; d: number };
  for (const u of w.units.values()) {
    if (u.kind !== 'mob' || u.dead || u.defId !== mobId) continue;
    const d = Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z);
    if (!best || d < best.d) best = { id: u.id, d };
  }
  return best;
}

/** Walk to a mob and kill it with auto-attack. */
export function killScript(mobId: string): (w: World, t: number) => Command[] {
  let targetId: number | null = null;
  return (w) => {
    const p = w.units.get(w.player.unitId)!;
    if (targetId === null || w.units.get(targetId)?.dead) {
      const n = nearestMob(w, mobId);
      if (!n) return [];
      targetId = n.id;
      return [{ t: 'target', id: targetId }];
    }
    const m = w.units.get(targetId)!;
    const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    const cmds: Command[] = [];
    if (d > 4) cmds.push({ t: 'move', dx, dz, facing: Math.atan2(dx, dz) });
    else if (!p.attacking) cmds.push({ t: 'cast', spellId: 'attack', targetId });
    return cmds;
  };
}
