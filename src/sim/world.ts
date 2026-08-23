import * as F from '../data/formulas';
import { CLASSES, statsAtLevel } from '../data/classes';
import { MOBS } from '../data/mobs';
import { ITEMS, SUFFIXES, SUFFIX_POOLS as POOLS } from '../data/items';
import { STARTER_ZONE } from '../data/zone.starter';
import { AURAS } from '../data/auras';
import { TALENTS } from '../data/talents';
import { mulberry32, randRange, randInt } from './rng';
import type { ItemInstance, ItemStats, Stats, Unit, World, PowerType, Vec } from './types';

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
export const ms = (t: number) => Math.round(t / F.TICK_MS);

export function log(w: World, kind: string, text: string) {
  const last = w.log[w.log.length - 1];
  if (last && last.kind === kind && last.text === text && kind === 'error') return; // don't spam held keys
  w.log.push({ tick: w.tick, kind, text });
  if (w.log.length > 400) w.log.splice(0, w.log.length - 400);
}
export function float(w: World, unitId: number, text: string, kind: string) {
  const u = w.units.get(unitId);
  if (u) w.floats.push({ x: u.pos.x, z: u.pos.z, text, kind, unitId });
}

export function itemStats(inst: ItemInstance): ItemStats {
  const def = ITEMS[inst.itemId];
  const s: ItemStats = { ...(def.stats ?? {}) };
  if (inst.suffixId) {
    const suf = SUFFIXES[inst.suffixId];
    for (const [k, v] of Object.entries(suf.stats)) (s as never as Record<string, number>)[k] = ((s as never as Record<string, number>)[k] ?? 0) + v;
  }
  return s;
}

export function itemName(inst: ItemInstance): string {
  const def = ITEMS[inst.itemId];
  return inst.suffixId ? `${def.name} ${SUFFIXES[inst.suffixId].name}` : def.name;
}

export function recomputeGear(w: World) {
  const u = w.units.get(w.player.unitId)!;
  const g: ItemStats = { str: 0, agi: 0, sta: 0, int: 0, spi: 0, ap: 0, crit: 0, armor: 0, spellPower: 0 };
  for (const inst of Object.values(w.player.equipped)) {
    if (!inst) continue;
    const s = itemStats(inst);
    for (const k of Object.keys(g) as (keyof ItemStats)[]) g[k] = (g[k] ?? 0) + ((s[k] as number) ?? 0);
  }
  u.gearStats = g;
  clampVitals(w, u);
}

/** Aura stat mods fold in on top of base + gear, so all three feed one effective-stat function. */
export function effStats(w: World, u: Unit): Stats & { ap: number; crit: number; armor: number; spellPower: number; speedPct: number } {
  const cls = CLASSES[u.classId];
  const s = {
    str: u.base.str + (u.gearStats.str ?? 0), agi: u.base.agi + (u.gearStats.agi ?? 0),
    sta: u.base.sta + (u.gearStats.sta ?? 0), int: u.base.int + (u.gearStats.int ?? 0),
    spi: u.base.spi + (u.gearStats.spi ?? 0),
    ap: u.gearStats.ap ?? 0, crit: u.gearStats.crit ?? 0,
    armor: (u.gearStats.armor ?? 0) + (cls?.armorGear ?? 0), spellPower: u.gearStats.spellPower ?? 0,
    speedPct: 0,
  };
  for (const a of u.auras) {
    const m = AURAS[a.defId]?.mods; if (!m) continue;
    for (const k of Object.keys(m) as (keyof typeof m)[]) {
      const v = (m[k] as number) * a.stacks;
      if (k in s) (s as never as Record<string, number>)[k] += v;
    }
  }
  if (u.kind === 'player') {
    for (const [id, rank] of Object.entries(w.player.talents)) {
      const t = TALENTS[id]; if (!t || !rank) continue;
      if (t.effect.kind === 'ap') s.ap += t.effect.value * rank;
      if (t.effect.kind === 'crit') s.crit += t.effect.value * rank;
      if (t.effect.kind === 'spellPower') s.spellPower += t.effect.value * rank;
    }
  }
  s.armor += s.agi * F.ARMOR_PER_AGI;
  s.ap += F.attackPowerFrom(s.str, u.level, cls?.apPerLevel ?? 1);
  s.spellPower += s.int * F.SPELLPOWER_PER_INT;
  return s;
}

export function maxHealthOf(w: World, u: Unit): number {
  if (u.kind !== 'player') return u.maxHealth;
  const cls = CLASSES[u.classId];
  return F.maxHealthFrom(effStats(w, u).sta, u.level, cls.healthPerLevel);
}
export function maxPowerOf(w: World, u: Unit): number {
  if (u.kind !== 'player') return u.maxPower;
  const cls = CLASSES[u.classId];
  if (cls.resource === 'rage') return F.MAX_RAGE;
  if (cls.resource === 'energy') return 100;
  return F.maxManaFrom(effStats(w, u).int, u.level, cls.manaPerLevel);
}

export function clampVitals(w: World, u: Unit) {
  const mh = maxHealthOf(w, u), mp = maxPowerOf(w, u);
  const hpFrac = u.maxHealth > 0 ? u.health / u.maxHealth : 1;
  u.maxHealth = mh;
  u.health = Math.min(mh, u.health === 0 ? 0 : Math.max(1, Math.round(hpFrac * mh)));
  u.maxPower = mp;
  u.power = Math.min(u.power, mp);
}

let idc = 1;
export function newUnit(partial: Partial<Unit>): Unit {
  return {
    id: idc++, kind: 'mob', defId: '', name: '', level: 1, classId: 'mob',
    pos: { x: 0, z: 0 }, facing: 0, velocity: { x: 0, z: 0 }, spawn: { x: 0, z: 0 },
    health: 1, maxHealth: 1, power: 0, maxPower: 0, powerType: 'none',
    base: { ...F.BASE_STATS }, gearStats: {}, auras: [],
    targetId: null, inCombat: false, dead: false, evading: false, deadUntilTick: 0,
    swingReadyTick: 0, gcdUntilTick: 0, casting: null, cooldowns: {},
    threat: new Map(), moveTo: null, attacking: false, aiCooldown: 0, queuedBonus: 0,
    ...partial,
  };
}

export function spawnMob(w: World, mobId: string, x: number, z: number, spawnPointId?: string): Unit {
  const d = MOBS[mobId];
  const u = newUnit({
    kind: 'mob', defId: mobId, name: d.name, level: d.level, classId: 'mob',
    pos: { x, z }, spawn: { x, z }, spawnPointId,
    health: d.health, maxHealth: d.health,
    power: d.mana ?? 0, maxPower: d.mana ?? 0, powerType: d.mana ? 'mana' : 'none',
    gearStats: { armor: d.armor },
  });
  u.id = w.nextId++;
  w.units.set(u.id, u);
  return u;
}

export function makeItem(w: World, itemId: string, count = 1): ItemInstance {
  const def = ITEMS[itemId];
  const inst: ItemInstance = { itemId, count };
  if (def.maxDurability) inst.durability = def.maxDurability;
  if (def.suffixPool) {
    const list = POOLS[def.suffixPool];
    if (list && list.length) inst.suffixId = list[randInt(w.rng, 0, list.length - 1)];
  }
  return inst;
}

export function createWorld(seed: number, classId: string, name: string): World {
  idc = 1;
  const cls = CLASSES[classId];
  const w: World = {
    tick: 0, rng: mulberry32(seed), units: new Map(), nextId: 1,
    player: {
      unitId: 1, xp: 0, restedXp: 0, copper: 0,
      bags: new Array(20).fill(null),
      equipped: {}, knownSpells: [...cls.startSpells],
      actionBar: new Array(10).fill(null),
      quests: [], completedQuests: [], talents: {}, talentPoints: 0, resting: false,
    },
    corpses: [], log: [], floats: [], zoneId: STARTER_ZONE.id,
    spawnTimers: {}, events: [], lastRegenTick: 0, paused: false,
  };

  const p = newUnit({
    kind: 'player', defId: classId, name, level: 1, classId,
    pos: { x: 0, z: 8 }, spawn: { x: 0, z: 8 },
    base: statsAtLevel(cls, 1), powerType: cls.resource as PowerType,
  });
  p.id = w.nextId++;
  w.units.set(p.id, p);
  w.player.unitId = p.id;

  for (const itemId of cls.startItems) {
    const inst = makeItem(w, itemId);
    const slot = ITEMS[itemId].slot;
    if (slot !== 'none') w.player.equipped[slot] = inst;
  }
  w.player.bags[0] = makeItem(w, 'tough_jerky', 4);
  if (cls.resource === 'mana') w.player.bags[1] = makeItem(w, 'refreshing_water', 4);

  recomputeGear(w);
  p.health = p.maxHealth; p.power = cls.resource === 'rage' ? 0 : p.maxPower;

  // Action bar: known spells first, auto-attack always slot 1.
  w.player.actionBar[0] = 'attack';
  let s = 1;
  for (const id of w.player.knownSpells) if (id !== 'attack' && s < 10) w.player.actionBar[s++] = id;

  // NPCs are units too, so targeting/nameplates/interaction use one code path.
  for (const n of STARTER_ZONE.npcs) {
    const u = newUnit({ kind: 'npc', defId: n.id, npcDefId: n.id, name: n.name, level: 10, classId: 'npc',
      pos: { x: n.x, z: n.z }, spawn: { x: n.x, z: n.z }, health: 500, maxHealth: 500 });
    u.id = w.nextId++;
    w.units.set(u.id, u);
  }

  for (const sp of STARTER_ZONE.spawns) {
    for (let i = 0; i < sp.count; i++) {
      const a = randRange(w.rng, 0, Math.PI * 2), r = randRange(w.rng, 0, sp.radius);
      spawnMob(w, sp.mobId, sp.x + Math.cos(a) * r, sp.z + Math.sin(a) * r, sp.id);
    }
  }

  log(w, 'system', `Welcome to ${STARTER_ZONE.name}, ${name}.`);
  return w;
}
