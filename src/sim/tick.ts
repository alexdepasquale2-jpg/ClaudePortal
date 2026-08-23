import * as F from '../data/formulas';
import { CLASSES } from '../data/classes';
import { SPELLS } from '../data/spells';
import { MOBS } from '../data/mobs';
import { STARTER_ZONE } from '../data/zone.starter';
import { isIncapacitated, tickAuras } from './auras';
import { autoAttack, killUnit } from './combat';
import { tickAI } from './ai';
import { tickCasts, startCast, interruptCast } from './spells';
import { addItem, buyItem, damageDurabilityOnDeath, equipFromBag, money, repairAll, sellItem, unequip } from './inventory';
import { corpseAt, lootAll, lootSlot, makeCorpse } from './loot';
import { acceptQuest, abandonQuest, completeQuest, onKill, onTalk, refreshAllQuests } from './quests';
import { availableTraining, grantXp, xpFromKill } from './xp';
import { clampVitals, dist, effStats, log, ms } from './world';
import type { Unit, World } from './types';
import type { Command } from '../net/protocol';

export function applyCommand(w: World, c: Command) {
  const p = w.units.get(w.player.unitId)!;
  if (p.dead && c.t !== 'revive') return;

  switch (c.t) {
    case 'move': {
      if (isIncapacitated(p)) break;
      const len = Math.hypot(c.dx, c.dz);
      p.facing = c.facing;
      if (len > 0) {
        if (p.casting) interruptCast(w, p);
        const speed = F.MOVE_SPEED * (F.TICK_MS / 1000);
        const half = STARTER_ZONE.size / 2;
        p.pos.x = clamp(p.pos.x + (c.dx / len) * speed, -half, half);
        p.pos.z = clamp(p.pos.z + (c.dz / len) * speed, -half, half);
        w.player.resting = false; // resting stops the moment you move
      }
      break;
    }
    case 'target': p.targetId = c.id; if (c.id === null) p.attacking = false; break;
    case 'cast': {
      const fail = startCast(w, p, c.spellId, c.targetId ?? p.targetId);
      if (fail) log(w, 'error', fail);
      break;
    }
    case 'stopcast': interruptCast(w, p); p.attacking = false; break;
    case 'loot': { const cp = corpseAt(w, c.corpseUnitId); if (cp && dist(p.pos, { x: cp.x, z: cp.z }) <= F.LOOT_RANGE_YD) lootAll(w, cp); break; }
    case 'lootSlot': { const cp = corpseAt(w, c.corpseUnitId); if (cp) lootSlot(w, cp, c.index); break; }
    case 'equip': equipFromBag(w, c.bagIndex); break;
    case 'unequip': unequip(w, c.slot); break;
    case 'sell': if (nearRole(w, 'vendor')) sellItem(w, c.bagIndex); break;
    case 'buy': if (nearRole(w, 'vendor')) buyItem(w, c.itemId); break;
    case 'repair': if (nearRole(w, 'vendor')) repairAll(w); break;
    case 'train': train(w, c.spellId); break;
    case 'acceptQuest': acceptQuest(w, c.questId); break;
    case 'completeQuest': completeQuest(w, c.questId, c.choice); break;
    case 'abandonQuest': abandonQuest(w, c.questId); break;
    case 'talk': onTalk(w, c.npcId); break;
    case 'rest': w.player.resting = c.on && !!nearRole(w, 'innkeeper'); break;
    case 'revive': revive(w, p); break;
    case 'setAction': w.player.actionBar[c.index] = c.spellId; break;
    case 'spendTalent':
      if (w.player.talentPoints > 0) {
        w.player.talents[c.talentId] = (w.player.talents[c.talentId] ?? 0) + 1;
        w.player.talentPoints--;
        log(w, 'system', `Talent point spent.`);
      }
      break;
  }
  refreshAllQuests(w);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function nearRole(w: World, role: string): Unit | null {
  const p = w.units.get(w.player.unitId)!;
  for (const u of w.units.values()) {
    if (u.kind !== 'npc') continue;
    const def = STARTER_ZONE.npcs.find(n => n.id === u.npcDefId);
    if (def?.roles.includes(role as never) && dist(p.pos, u.pos) <= F.INTERACT_RANGE_YD) return u;
  }
  return null;
}

function train(w: World, spellId: string) {
  if (!nearRole(w, 'trainer')) { log(w, 'error', 'You must be near a trainer.'); return; }
  const p = w.units.get(w.player.unitId)!;
  const sp = SPELLS[spellId];
  if (!sp || sp.classId !== p.classId) { log(w, 'error', 'Your trainer cannot teach that.'); return; }
  if (w.player.knownSpells.includes(spellId)) return;
  if (p.level < sp.reqLevel) { log(w, 'error', `Requires level ${sp.reqLevel}.`); return; }
  const cost = sp.trainCostCopper ?? 0;
  if (w.player.copper < cost) { log(w, 'error', `You need ${money(cost)} to learn that.`); return; }
  w.player.copper -= cost;
  w.player.knownSpells.push(spellId);
  const free = w.player.actionBar.findIndex(s => s === null);
  if (free >= 0) w.player.actionBar[free] = spellId;
  log(w, 'system', `You have learned ${sp.name}.`);
  w.events.push(`learned:${spellId}`);
}

function revive(w: World, p: Unit) {
  p.dead = false;
  p.pos = { x: 0, z: 8 };
  p.health = Math.max(1, Math.round(p.maxHealth * 0.5));
  p.power = p.powerType === 'mana' ? Math.round(p.maxPower * 0.5) : 0;
  p.auras = []; p.inCombat = false; p.targetId = null;
  log(w, 'system', 'You return to life at the graveyard.');
}

export function tick(w: World, commands: Command[]) {
  w.tick++;
  w.floats.length = 0;
  w.events.length = 0;

  for (const c of commands) applyCommand(w, c);

  const p = w.units.get(w.player.unitId)!;
  tickCasts(w);
  tickAuras(w);

  if (p.attacking && !p.dead) autoAttack(w, p);
  tickAI(w);

  // Anything that fell to zero from a periodic tick dies here, on the same code path as a swing kill.
  for (const u of w.units.values()) if (!u.dead && u.health <= 0) killUnit(w, u, p);

  accrueRested(w);
  regen(w);
  decayRage(w, p);
  dropCombatIfClear(w, p);
  handleDeaths(w);

  for (let i = w.corpses.length - 1; i >= 0; i--) {
    const c = w.corpses[i];
    if (c.looted || w.tick > c.expiresTick) w.corpses.splice(i, 1);
  }
  refreshAllQuests(w);
  return w;
}

function handleDeaths(w: World) {
  const p = w.units.get(w.player.unitId)!;
  for (const ev of [...w.events]) {
    const [kind, idStr, killerStr] = ev.split(':');
    if (kind !== 'death' && kind !== 'dotkill') continue;
    const u = w.units.get(Number(idStr));
    if (!u) continue;
    if (u.kind === 'player') { onPlayerDeath(w, u); continue; }
    const killedByPlayer = Number(killerStr) === p.id || (u.threat.get(p.id) ?? 0) > 0;
    if (!killedByPlayer) continue;
    makeCorpse(w, u);
    grantXp(w, xpFromKill(w, u), MOBS[u.defId].name);
    onKill(w, u.defId);
  }
}

function onPlayerDeath(w: World, p: Unit) {
  damageDurabilityOnDeath(w);
  log(w, 'death', 'You have died. Press the Release button to return to the graveyard.');
}

function regen(w: World) {
  if (w.tick - w.lastRegenTick < ms(F.REGEN_TICK_MS)) return;
  w.lastRegenTick = w.tick;
  for (const u of w.units.values()) {
    if (u.dead) continue;
    if (u.inCombat && !F.COMBAT_REGEN) continue;
    const s = effStats(w, u);
    u.health = Math.min(u.maxHealth, u.health + Math.max(1, s.spi * F.HEALTH_REGEN_PER_SPI));
    if (u.powerType === 'mana') u.power = Math.min(u.maxPower, u.power + Math.max(1, s.spi * F.MANA_REGEN_PER_SPI));
  }
}

/** Rested XP fills while you sit in an inn, capped at 1.5 levels of banked bonus. */
function accrueRested(w: World) {
  if (!w.player.resting) return;
  const p = w.units.get(w.player.unitId)!;
  const hours = (F.TICK_MS / 3_600_000) * F.TIME_SCALE;
  const perTick = F.xpToLevel(p.level) * F.RESTED_PER_HOUR_INN * hours;
  w.player.restedXp = Math.min(F.xpToLevel(p.level) * F.RESTED_CAP_LEVELS, w.player.restedXp + perTick);
}

/** Rage bleeds away out of combat — you cannot bank it between pulls. */
function decayRage(w: World, p: Unit) {
  if (p.powerType !== 'rage' || p.inCombat) return;
  p.power = Math.max(0, p.power - F.RAGE_DECAY_PER_SEC * (F.TICK_MS / 1000));
}

function dropCombatIfClear(w: World, p: Unit) {
  if (!p.inCombat) return;
  for (const u of w.units.values())
    if (u.kind === 'mob' && !u.dead && u.inCombat && u.targetId === p.id) return;
  p.inCombat = false;
  p.attacking = false;
}

export { availableTraining, addItem, clampVitals, CLASSES };
