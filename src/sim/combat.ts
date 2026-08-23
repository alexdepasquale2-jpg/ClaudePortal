import * as F from '../data/formulas';
import { ITEMS } from '../data/items';
import { MOBS } from '../data/mobs';
import { CLASSES } from '../data/classes';
import { randRange } from './rng';
import { rollAttack, rollSpell } from './attackTable';
import { applyAura, hasAura, removeAura, breakOnDamage } from './auras';
import { dist, effStats, float, log, ms } from './world';
import type { AttackOutcome, School, Unit, World } from './types';

export function weaponOf(w: World, u: Unit) {
  if (u.kind === 'player') {
    const mh = w.player.equipped.mainhand;
    if (mh && ITEMS[mh.itemId].weapon) return { ...ITEMS[mh.itemId].weapon!, broken: (mh.durability ?? 1) <= 0 };
    return { min: 1, max: 2, speedMs: 2000, kind: 'sword' as const, broken: false }; // unarmed
  }
  const d = MOBS[u.defId];
  return { min: d.dmg.min, max: d.dmg.max, speedMs: d.attackSpeedMs, kind: 'sword' as const, broken: false };
}

/** Classic weapon damage = (rolled weapon damage + AP/14 * weaponSpeed). */
export function weaponSwingDamage(w: World, u: Unit, bonusFlat = 0): number {
  const wep = weaponOf(w, u);
  const a = effStats(w, u);
  const speed = wep.speedMs / 1000;
  let base = randRange(w.rng, wep.min, wep.max) + (a.ap / F.AP_TO_DPS) * speed + bonusFlat;
  if (wep.broken) base *= 0.5; // broken gear halves output
  return base;
}

export function addThreat(w: World, target: Unit, source: Unit, amount: number) {
  if (target.kind !== 'mob') return;
  target.threat.set(source.id, (target.threat.get(source.id) ?? 0) + amount);
  if (!target.inCombat) enterCombat(w, target, source);
  const cur = target.targetId ? target.threat.get(target.targetId) ?? 0 : 0;
  const mine = target.threat.get(source.id)!;
  const isMelee = dist(target.pos, source.pos) <= F.MELEE_RANGE + 1;
  if (mine > cur * (isMelee ? F.THREAT_PULL_MELEE : F.THREAT_PULL_RANGED)) target.targetId = source.id;
}

export function enterCombat(w: World, u: Unit, foe: Unit) {
  if (!u.inCombat) { u.inCombat = true; u.evading = false; }
  if (u.kind === 'mob' && !u.targetId) u.targetId = foe.id;
  if (!foe.inCombat) foe.inCombat = true;
}

export function applyDamage(w: World, attacker: Unit, target: Unit, raw: number, school: School, sourceName: string, outcome: AttackOutcome) {
  if (target.dead) return 0;
  let dmg = raw;
  if (school === 'physical') dmg *= 1 - F.armorDR(effStats(w, target).armor, attacker.level);
  dmg = Math.max(1, Math.round(dmg));

  target.health -= dmg;
  breakOnDamage(w, target, dmg);

  const critTag = outcome === 'crit' ? ' (Critical)' : outcome === 'glancing' ? ' (Glancing)' : outcome === 'crushing' ? ' (Crushing)' : outcome === 'block' ? ' (Blocked)' : '';
  log(w, attacker.kind === 'player' ? 'dmg-out' : 'dmg-in',
    `${attacker.name}'s ${sourceName} hits ${target.name} for ${dmg}${school !== 'physical' ? ' ' + school : ''} damage.${critTag}`);
  float(w, target.id, `${outcome === 'crit' ? '*' : ''}${dmg}${outcome === 'crit' ? '*' : ''}`, attacker.kind === 'player' ? 'dmg-out' : 'dmg-in');

  addThreat(w, target, attacker, dmg * F.THREAT_PER_DAMAGE);
  enterCombat(w, attacker, target);
  enterCombat(w, target, attacker);

  // Rage flows from damage dealt AND taken; taken is the bigger source at low level.
  if (target.powerType === 'rage') gainPower(w, target, F.rageFromDamageTaken(dmg, target.level));
  if (attacker.powerType === 'rage') gainPower(w, attacker, F.rageFromDamageDealt(dmg, attacker.level));

  if (target.health <= 0) killUnit(w, target, attacker);
  return dmg;
}

export function applyHeal(w: World, source: Unit, target: Unit, raw: number, sourceName: string) {
  const amt = Math.min(Math.round(raw), target.maxHealth - target.health);
  target.health += amt;
  log(w, 'heal', `${source.name}'s ${sourceName} heals ${target.name} for ${amt}.`);
  if (amt > 0) float(w, target.id, `+${amt}`, 'heal');
}

export function gainPower(w: World, u: Unit, amount: number) {
  if (u.powerType === 'none') return;
  u.power = Math.max(0, Math.min(u.maxPower, u.power + amount));
}

export function killUnit(w: World, u: Unit, killer: Unit) {
  u.dead = true; u.health = 0; u.inCombat = false; u.targetId = null;
  u.auras = []; u.casting = null; u.attacking = false;
  u.deadUntilTick = w.tick + ms(F.RESPAWN_MS);
  log(w, 'death', `${u.name} dies.`);
  w.events.push(`death:${u.id}:${killer.id}`);
}

export function autoAttack(w: World, u: Unit) {
  if (u.dead || !u.targetId) return;
  const t = w.units.get(u.targetId);
  if (!t || t.dead || t.kind === 'npc') return;
  if (dist(u.pos, t.pos) > F.MELEE_RANGE) return;
  if (w.tick < u.swingReadyTick) return;

  const wep = weaponOf(w, u);
  u.swingReadyTick = w.tick + ms(wep.speedMs);
  const bonus = u.kind === 'player' ? consumeHeroicStrike(w, u) : 0;
  swing(w, u, t, weaponSwingDamage(w, u, bonus), bonus > 0 ? 'Heroic Strike' : 'melee swing');
}

export function consumeHeroicStrike(_w: World, u: Unit): number {
  const b = u.queuedBonus; u.queuedBonus = 0; return b;
}

export function swing(w: World, atk: Unit, def: Unit, damage: number, name: string, opts: { cannotMiss?: boolean } = {}) {
  const outcome = rollAttack(w, atk, def, opts);
  switch (outcome) {
    case 'miss': log(w, 'miss', `${atk.name}'s ${name} misses ${def.name}.`); float(w, def.id, 'Miss', 'miss'); break;
    case 'dodge':
      log(w, 'miss', `${def.name} dodges ${atk.name}'s ${name}.`); float(w, def.id, 'Dodge', 'miss');
      // The dodge is what opens the Overpower window — this is the proc, not a talent.
      if (atk.kind === 'player' && atk.classId === 'warrior') applyAura(w, atk, atk, 'overpower_window');
      break;
    case 'parry': log(w, 'miss', `${def.name} parries ${atk.name}'s ${name}.`); float(w, def.id, 'Parry', 'miss'); break;
    case 'glancing': applyDamage(w, atk, def, damage * randRange(w.rng, F.GLANCING_DAMAGE.lo, F.GLANCING_DAMAGE.hi), 'physical', name, outcome); break;
    case 'crit': applyDamage(w, atk, def, damage * F.MELEE_CRIT_MULT, 'physical', name, outcome); break;
    case 'crushing': applyDamage(w, atk, def, damage * F.CRUSHING_MULT, 'physical', name, outcome); break;
    case 'block': applyDamage(w, atk, def, Math.max(1, damage - 5), 'physical', name, outcome); break;
    default: applyDamage(w, atk, def, damage, 'physical', name, outcome);
  }
  enterCombat(w, atk, def);
  enterCombat(w, def, atk);
  return outcome;
}

export function spellDamage(w: World, atk: Unit, def: Unit, min: number, max: number, school: School, spCoef: number, name: string) {
  const outcome = rollSpell(w, atk, def);
  if (outcome === 'resist') {
    log(w, 'miss', `${atk.name}'s ${name} was resisted by ${def.name}.`); float(w, def.id, 'Resist', 'miss');
    addThreat(w, def, atk, 1);
    return;
  }
  const sp = effStats(w, atk).spellPower;
  let dmg = randRange(w.rng, min, max) + sp * spCoef;
  if (outcome === 'crit') dmg *= F.SPELL_CRIT_MULT;
  applyDamage(w, atk, def, dmg, school, name, outcome);
}

export { hasAura, removeAura };
export const classResource = (id: string) => CLASSES[id]?.resource ?? 'none';
