import * as F from '../data/formulas';
import { MOBS } from '../data/mobs';
import { SPELLS } from '../data/spells';
import { isIncapacitated } from './auras';
import { autoAttack, enterCombat } from './combat';
import { startCast } from './spells';
import { dist, log, ms, spawnMob } from './world';
import type { Unit, World } from './types';
import { STARTER_ZONE } from '../data/zone.starter';
import { AURAS } from '../data/auras';

function moveToward(u: Unit, tx: number, tz: number, speed: number, slowPct: number) {
  const dx = tx - u.pos.x, dz = tz - u.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return;
  const s = Math.max(0, speed * (1 + slowPct / 100)) * (F.TICK_MS / 1000);
  const step = Math.min(d, s);
  u.pos.x += (dx / d) * step; u.pos.z += (dz / d) * step;
  u.facing = Math.atan2(dx, dz);
}

const SPEED_AURAS: Record<string, number> = Object.fromEntries(
  Object.values(AURAS).filter(a => a.mods?.speedPct).map(a => [a.id, a.mods!.speedPct!]));

function slowOf(u: Unit): number {
  return Math.max(-100, u.auras.reduce((acc, a) => acc + (SPEED_AURAS[a.defId] ?? 0), 0));
}

export function tickAI(w: World) {
  const player = w.units.get(w.player.unitId)!;

  for (const u of w.units.values()) {
    if (u.kind !== 'mob') continue;

    if (u.dead) {
      if (w.tick >= u.deadUntilTick && !w.corpses.some(c => c.unitId === u.id && !c.looted)) respawn(w, u);
      continue;
    }
    if (isIncapacitated(u)) { u.moveTo = null; continue; }

    // Leash: dragged too far from spawn, evade home at full heal and drop all threat.
    if (u.inCombat && dist(u.pos, u.spawn) > (MOBS[u.defId].leashYd ?? F.LEASH_YD)) {
      u.evading = true; u.inCombat = false; u.targetId = null; u.threat.clear();
      log(w, 'system', `${u.name} evades.`);
    }
    if (u.evading) {
      moveToward(u, u.spawn.x, u.spawn.z, F.MOB_MOVE_SPEED * 1.6, 0);
      u.health = Math.min(u.maxHealth, u.health + u.maxHealth * F.EVADE_HEAL_PER_SEC * (F.TICK_MS / 1000));
      if (dist(u.pos, u.spawn) < 1 && u.health >= u.maxHealth) { u.evading = false; u.health = u.maxHealth; }
      continue;
    }

    if (!u.inCombat) {
      if (!player.dead && dist(u.pos, player.pos) <= F.aggroRadius(u.level, player.level)) {
        enterCombat(w, u, player);
        u.threat.set(player.id, 1);
        u.targetId = player.id;
        socialPull(w, u, player);
        log(w, 'system', `${u.name} attacks you!`);
      }
      continue;
    }

    const t = u.targetId ? w.units.get(u.targetId) : null;
    if (!t || t.dead) { u.inCombat = false; u.targetId = null; u.threat.clear(); continue; }

    const d = dist(u.pos, t.pos);
    const spells = MOBS[u.defId].spells ?? [];
    if (spells.length && !u.casting && u.aiCooldown <= w.tick) {
      const sid = spells[0];
      const sp = SPELLS[sid];
      if ((u.cooldowns[sid] ?? 0) <= w.tick && d <= sp.rangeYd) {
        startCast(w, u, sid, t.id);
        u.aiCooldown = w.tick + ms(1000);
        continue;
      }
    }
    const desired = spells.length && SPELLS[spells[0]].rangeYd > F.MELEE_RANGE ? Math.min(20, sp0Range(spells[0])) : F.MELEE_RANGE - 1;
    if (d > desired) moveToward(u, t.pos.x, t.pos.z, F.MOB_MOVE_SPEED, slowOf(u));
    else { u.facing = Math.atan2(t.pos.x - u.pos.x, t.pos.z - u.pos.z); autoAttack(w, u); }
  }
}

const sp0Range = (id: string) => SPELLS[id].rangeYd - 4;

function socialPull(w: World, u: Unit, foe: Unit) {
  if (!MOBS[u.defId].social) return;
  for (const o of w.units.values()) {
    if (o.kind !== 'mob' || o.dead || o.inCombat || o.id === u.id) continue;
    if (MOBS[o.defId].family !== MOBS[u.defId].family) continue;
    if (dist(o.pos, u.pos) <= F.SOCIAL_AGGRO_YD) {
      enterCombat(w, o, foe); o.targetId = foe.id; o.threat.set(foe.id, 1);
    }
  }
}

function respawn(w: World, u: Unit) {
  w.units.delete(u.id);
  const fresh = spawnMob(w, u.defId, u.spawn.x, u.spawn.z, u.spawnPointId);
  fresh.health = fresh.maxHealth;
}

export { moveToward };
