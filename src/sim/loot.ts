import * as F from '../data/formulas';
import { LOOT } from '../data/loot';
import { MOBS } from '../data/mobs';
import { randInt, roll100 } from './rng';
import { addItem, money } from './inventory';
import { dist, itemName, log, makeItem, ms } from './world';
import type { Corpse, ItemInstance, Unit, World } from './types';

export function makeCorpse(w: World, u: Unit): Corpse | null {
  const tableId = MOBS[u.defId]?.lootTable;
  const loot: ItemInstance[] = [];
  let copper = 0;
  if (tableId) {
    const t = LOOT[tableId];
    copper = randInt(w.rng, t.money.min, t.money.max);
    for (const e of t.entries) {
      if (roll100(w.rng) < e.chance) {
        const n = e.min ? randInt(w.rng, e.min, e.max ?? e.min) : 1;
        loot.push(makeItem(w, e.itemId, n));
      }
    }
  }
  const c: Corpse = { unitId: u.id, x: u.pos.x, z: u.pos.z, mobId: u.defId, loot, copper, looted: false, expiresTick: w.tick + ms(F.RESPAWN_MS - 2000) };
  w.corpses.push(c);
  return c;
}

export const corpseAt = (w: World, unitId: number) => w.corpses.find(c => c.unitId === unitId && !c.looted);

export function lootableCorpses(w: World): Corpse[] {
  const p = w.units.get(w.player.unitId)!;
  return w.corpses.filter(c => !c.looted && dist(p.pos, { x: c.x, z: c.z }) <= F.LOOT_RANGE_YD);
}

export function lootSlot(w: World, corpse: Corpse, index: number) {
  const inst = corpse.loot[index];
  if (!inst) return;
  if (!addItem(w, inst)) return;
  corpse.loot.splice(index, 1);
  if (!corpse.loot.length && corpse.copper === 0) corpse.looted = true;
  w.events.push(`loot:${inst.itemId}`);
}

export function lootAll(w: World, corpse: Corpse) {
  if (corpse.copper) {
    w.player.copper += corpse.copper;
    log(w, 'money', `You loot ${money(corpse.copper)}.`);
    corpse.copper = 0;
  }
  for (let i = corpse.loot.length - 1; i >= 0; i--) lootSlot(w, corpse, i);
  if (!corpse.loot.length) corpse.looted = true;
}

export const lootName = itemName;
