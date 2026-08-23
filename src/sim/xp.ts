import * as F from '../data/formulas';
import { CLASSES, statsAtLevel } from '../data/classes';
import { MOBS } from '../data/mobs';
import { SPELLS } from '../data/spells';
import { clampVitals, log, float } from './world';
import type { Unit, World } from './types';

export function grantXp(w: World, amount: number, reason: string) {
  const p = w.units.get(w.player.unitId)!;
  if (p.level >= 10) { log(w, 'xp', `You are at the level cap for this zone.`); return; }
  let total = Math.round(amount);
  if (w.player.restedXp > 0) {
    const bonus = Math.min(w.player.restedXp, total * (F.RESTED_MULT - 1));
    w.player.restedXp -= bonus;
    total += Math.round(bonus);
  }
  w.player.xp += total;
  log(w, 'xp', `You gain ${total} experience${reason ? ` (${reason})` : ''}.`);
  float(w, p.id, `+${total} XP`, 'xp');
  while (w.player.xp >= F.xpToLevel(p.level) && p.level < 10) {
    w.player.xp -= F.xpToLevel(p.level);
    levelUp(w, p);
  }
}

export function xpFromKill(w: World, mob: Unit): number {
  const p = w.units.get(w.player.unitId)!;
  const def = MOBS[mob.defId];
  const base = def.xpBaseOverride ?? F.mobBaseXp(mob.level);
  return Math.round(base * F.xpLevelMod(p.level, mob.level) * (def.elite ? 2 : 1));
}

export function levelUp(w: World, p: Unit) {
  p.level++;
  const cls = CLASSES[p.classId];
  p.base = statsAtLevel(cls, p.level);
  clampVitals(w, p);
  p.health = p.maxHealth;
  if (p.powerType === 'mana') p.power = p.maxPower;
  // Classic hands out the first talent point at level 10; this slice caps there, so exactly one.
  if (p.level >= 10) w.player.talentPoints += 1;
  log(w, 'level', `You have reached level ${p.level}!`);
  float(w, p.id, `LEVEL UP!`, 'level');
  w.events.push(`levelup:${p.level}`);

  const avail = availableTraining(w).filter(s => SPELLS[s].reqLevel === p.level);
  if (avail.length) log(w, 'system', `New abilities are available from your trainer.`);
}

/** Classic gives the first talent point at 10; this slice caps at 10 so you get exactly one. */
export function availableTraining(w: World): string[] {
  const p = w.units.get(w.player.unitId)!;
  return Object.values(SPELLS)
    .filter(s => s.classId === p.classId && s.reqLevel <= p.level && !w.player.knownSpells.includes(s.id))
    .map(s => s.id);
}

export const xpToNext = (level: number) => F.xpToLevel(level);
