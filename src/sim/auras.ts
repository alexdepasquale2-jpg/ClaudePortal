import { AURAS } from '../data/auras';
import { randRange } from './rng';
import { clampVitals, float, log, ms } from './world';
import type { Unit, World } from './types';

export const hasAura = (u: Unit, id: string) => u.auras.some(a => a.defId === id);
export const getAura = (u: Unit, id: string) => u.auras.find(a => a.defId === id);

export function removeAura(w: World, u: Unit, id: string) {
  const i = u.auras.findIndex(a => a.defId === id);
  if (i < 0) return;
  u.auras.splice(i, 1);
  clampVitals(w, u);
  log(w, 'aura', `${AURAS[id].name} fades from ${u.name}.`);
}

/** Classic refresh: reapplying resets duration flat — no pandemic window, no partial carry-over. */
export function applyAura(w: World, source: Unit, target: Unit, id: string) {
  const def = AURAS[id];
  if (!def || target.dead) return;
  const dur = ms(def.durationMs);
  const existing = getAura(target, id);
  if (existing) {
    existing.expiresTick = w.tick + dur;
    existing.stacks = Math.min(def.maxStacks, existing.stacks + 1);
    existing.sourceId = source.id;
  } else {
    target.auras.push({
      defId: id, sourceId: source.id, stacks: 1,
      expiresTick: w.tick + dur, appliedTick: w.tick,
      nextTick: def.tickMs ? w.tick + ms(def.tickMs) : Infinity,
    });
    log(w, 'aura', `${target.name} is afflicted by ${def.name}.`);
  }
  clampVitals(w, target);
}

/** Polymorph and friends break the instant any damage lands. */
export function breakOnDamage(w: World, u: Unit, damage: number) {
  for (const a of [...u.auras]) {
    const def = AURAS[a.defId];
    if (def.breakOnDamage && damage >= (def.breakDamageThreshold ?? 1)) {
      removeAura(w, u, a.defId);
      log(w, 'aura', `${def.name} on ${u.name} breaks early.`);
    }
  }
}

export const isIncapacitated = (u: Unit) => u.auras.some(a => AURAS[a.defId]?.incapacitate);

export function tickAuras(w: World) {
  for (const u of w.units.values()) {
    if (!u.auras.length) continue;
    for (const a of [...u.auras]) {
      const def = AURAS[a.defId];
      if (w.tick >= a.expiresTick) { removeAura(w, u, a.defId); continue; }
      if (def.periodic && w.tick >= a.nextTick) {
        a.nextTick = w.tick + ms(def.tickMs!);
        const src = w.units.get(a.sourceId) ?? u;
        const amt = Math.round(randRange(w.rng, def.periodic.min, def.periodic.max) * a.stacks);
        if (def.periodic.kind === 'damage') {
          // Periodic damage does not go through the attack table; it always lands.
          u.health -= amt;
          log(w, 'dot', `${u.name} suffers ${amt} damage from ${def.name}.`);
          float(w, u.id, `${amt}`, 'dot');
          if (u.kind === 'mob') u.threat.set(src.id, (u.threat.get(src.id) ?? 0) + amt);
          if (u.health <= 0) w.events.push(`dotkill:${u.id}:${src.id}`);
        } else {
          u.health = Math.min(u.maxHealth, u.health + amt);
        }
      }
    }
  }
}
