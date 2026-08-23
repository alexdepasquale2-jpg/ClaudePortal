import * as F from '../data/formulas';
import { SPELLS } from '../data/spells';
import { AURAS } from '../data/auras';
import { randRange } from './rng';
import { applyAura, hasAura, isIncapacitated, removeAura } from './auras';
import { addThreat, applyHeal, enterCombat, gainPower, spellDamage, swing, weaponSwingDamage } from './combat';
import { dist, log, ms } from './world';
import type { SpellDef, Unit, World } from './types';

export type CastFail = null | string;

export function canCast(w: World, u: Unit, spellId: string, targetId: number | null): CastFail {
  const sp = SPELLS[spellId];
  if (!sp) return 'Unknown spell.';
  if (u.dead) return 'You are dead.';
  if (isIncapacitated(u)) return 'You are incapacitated.';
  if (u.kind === 'player' && !w.player.knownSpells.includes(spellId)) return 'You have not learned that.';
  if (u.level < sp.reqLevel) return `Requires level ${sp.reqLevel}.`;
  if (sp.gcd && w.tick < u.gcdUntilTick) return 'Not ready yet.';
  if ((u.cooldowns[spellId] ?? 0) > w.tick) return 'That ability is not ready yet.';
  if (sp.requiresAura && !hasAura(u, sp.requiresAura)) return `${sp.name} is not ready.`;
  if (sp.resource !== 'none' && sp.cost > 0 && u.power < sp.cost)
    return sp.resource === 'rage' ? 'Not enough rage.' : 'Not enough mana.';
  if (sp.requiresTargetHostile) {
    const t = targetId ? w.units.get(targetId) : null;
    if (!t || t.kind === 'npc') return 'You have no target.';
    if (t.dead) return 'Your target is dead.';
    if (dist(u.pos, t.pos) > sp.rangeYd) return 'Out of range.';
  }
  if (u.casting) return 'Already casting.';
  return null;
}

export function startCast(w: World, u: Unit, spellId: string, targetId: number | null): CastFail {
  const fail = canCast(w, u, spellId, targetId);
  if (fail) return fail;
  const sp = SPELLS[spellId];

  if (spellId === 'attack') {
    u.attacking = !u.attacking;
    u.targetId = targetId;
    log(w, 'system', u.attacking ? 'Auto-attack enabled.' : 'Auto-attack disabled.');
    return null;
  }

  if (sp.castMs > 0) {
    u.casting = { spellId, targetId, endTick: w.tick + ms(sp.castMs) };
    if (sp.gcd) u.gcdUntilTick = w.tick + ms(F.GCD_MS);
    log(w, 'cast', `${u.name} begins to cast ${sp.name}.`);
    return null;
  }
  finishCast(w, u, spellId, targetId);
  return null;
}

export function finishCast(w: World, u: Unit, spellId: string, targetId: number | null) {
  const sp = SPELLS[spellId];
  const fail = spendAndValidate(w, u, sp, targetId);
  if (fail) { log(w, 'error', fail); return; }

  const target = targetId ? w.units.get(targetId) ?? null : null;
  // The GCD starts when a cast begins, not when it lands, so it never stacks behind a cast time.
  if (sp.gcd && sp.castMs === 0) u.gcdUntilTick = w.tick + ms(F.GCD_MS);
  if (sp.cooldownMs) u.cooldowns[spellId] = w.tick + ms(sp.cooldownMs);
  if (sp.consumesAura) removeAura(w, u, sp.consumesAura);
  if (u.kind === 'player') log(w, 'cast', `You cast ${sp.name}.`);

  // Heroic Strike is an "on next swing" ability in Classic: it rides the next auto-attack.
  if (spellId === 'heroic_strike') {
    const eff = sp.effects.find(e => e.kind === 'damage') as never as { weaponBonus: number };
    u.queuedBonus = eff.weaponBonus;
    if (target) { u.targetId = target.id; u.attacking = true; enterCombat(w, u, target); }
    log(w, 'cast', 'Heroic Strike is queued for your next swing.');
    return;
  }

  for (const e of sp.effects) {
    switch (e.kind) {
      case 'damage': {
        if (!target) break;
        if (e.weapon) {
          swing(w, u, target, weaponSwingDamage(w, u, e.weaponBonus ?? 0), sp.name,
            { cannotMiss: spellId === 'overpower' });
        } else {
          spellDamage(w, u, target, e.min, e.max, e.school, e.spCoef ?? 0, sp.name);
        }
        break;
      }
      case 'heal': {
        const t = target && !sp.requiresTargetHostile ? target : u;
        applyHeal(w, u, t, randRange(w.rng, e.min, e.max), sp.name);
        break;
      }
      case 'aura': {
        const t = e.toSelf || !target ? u : target;
        applyAura(w, u, t, e.auraId);
        if (!e.toSelf && target && AURAS[e.auraId] && !AURAS[e.auraId].helpful) addThreat(w, target, u, 5);
        break;
      }
      case 'threat': if (target) addThreat(w, target, u, e.amount); break;
      case 'power': gainPower(w, u, e.amount); break;
    }
  }

  if (target && sp.requiresTargetHostile) { enterCombat(w, u, target); enterCombat(w, target, u); }
}

function spendAndValidate(w: World, u: Unit, sp: SpellDef, targetId: number | null): CastFail {
  if (sp.resource !== 'none' && sp.cost > 0) {
    if (u.power < sp.cost) return sp.resource === 'rage' ? 'Not enough rage.' : 'Not enough mana.';
    u.power -= sp.cost;
  }
  if (sp.requiresTargetHostile) {
    const t = targetId ? w.units.get(targetId) : null;
    if (!t || t.dead) return 'Your target is gone.';
    if (dist(u.pos, t.pos) > sp.rangeYd) return 'Out of range.';
  }
  return null;
}

export function tickCasts(w: World) {
  for (const u of w.units.values()) {
    if (!u.casting) continue;
    if (u.dead || isIncapacitated(u)) { u.casting = null; continue; }
    if (w.tick >= u.casting.endTick) {
      const { spellId, targetId } = u.casting;
      u.casting = null;
      finishCast(w, u, spellId, targetId);
    }
  }
}

export function interruptCast(w: World, u: Unit) {
  if (!u.casting) return;
  log(w, 'cast', `${u.name}'s ${SPELLS[u.casting.spellId].name} is interrupted.`);
  u.casting = null;
}

export const spellsForClass = (classId: string) =>
  Object.values(SPELLS).filter(s => s.classId === classId);
