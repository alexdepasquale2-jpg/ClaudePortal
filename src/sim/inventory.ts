import * as F from '../data/formulas';
import { ITEMS } from '../data/items';
import { itemName, log, recomputeGear } from './world';
import type { ItemInstance, Slot, World } from './types';

export function countItem(w: World, itemId: string): number {
  return w.player.bags.reduce((n, s) => n + (s && s.itemId === itemId ? s.count : 0), 0);
}

export function addItem(w: World, inst: ItemInstance): boolean {
  const def = ITEMS[inst.itemId];
  if (def.stack && def.stack > 1) {
    for (const slot of w.player.bags) {
      if (slot && slot.itemId === inst.itemId && slot.count < def.stack) {
        const room = def.stack - slot.count;
        const move = Math.min(room, inst.count);
        slot.count += move; inst.count -= move;
        if (inst.count <= 0) { log(w, 'loot', `You receive item: ${itemName(inst)}.`); return true; }
      }
    }
  }
  const empty = w.player.bags.findIndex(s => s === null);
  if (empty < 0) { log(w, 'error', 'Your bags are full.'); return false; }
  w.player.bags[empty] = inst;
  log(w, 'loot', `You receive item: ${itemName(inst)}${inst.count > 1 ? ` x${inst.count}` : ''}.`);
  return true;
}

export function removeItem(w: World, itemId: string, count = 1): boolean {
  if (countItem(w, itemId) < count) return false;
  let left = count;
  for (let i = 0; i < w.player.bags.length && left > 0; i++) {
    const s = w.player.bags[i];
    if (!s || s.itemId !== itemId) continue;
    const take = Math.min(s.count, left);
    s.count -= take; left -= take;
    if (s.count <= 0) w.player.bags[i] = null;
  }
  return true;
}

export function equipFromBag(w: World, bagIndex: number): boolean {
  const inst = w.player.bags[bagIndex];
  if (!inst) return false;
  const def = ITEMS[inst.itemId];
  if (def.slot === 'none') { log(w, 'error', `${def.name} cannot be equipped.`); return false; }
  const prev = w.player.equipped[def.slot as Slot];
  w.player.equipped[def.slot as Slot] = inst;
  w.player.bags[bagIndex] = prev ?? null;
  recomputeGear(w);
  log(w, 'system', `Equipped ${itemName(inst)}.`);
  w.events.push(`equip:${def.slot}:${inst.itemId}`);
  return true;
}

export function unequip(w: World, slot: Slot): boolean {
  const inst = w.player.equipped[slot];
  if (!inst) return false;
  const empty = w.player.bags.findIndex(s => s === null);
  if (empty < 0) { log(w, 'error', 'Your bags are full.'); return false; }
  w.player.bags[empty] = inst;
  delete w.player.equipped[slot];
  recomputeGear(w);
  w.events.push(`equip:${slot}:none`);
  return true;
}

export function sellItem(w: World, bagIndex: number): boolean {
  const inst = w.player.bags[bagIndex];
  if (!inst) return false;
  const def = ITEMS[inst.itemId];
  if (def.quest) { log(w, 'error', 'You cannot sell a quest item.'); return false; }
  const copper = Math.max(1, Math.floor(def.vendorCopper * F.VENDOR_SELL_RATIO)) * inst.count;
  w.player.copper += copper;
  w.player.bags[bagIndex] = null;
  log(w, 'money', `Sold ${itemName(inst)} for ${money(copper)}.`);
  return true;
}

export function buyItem(w: World, itemId: string): boolean {
  const def = ITEMS[itemId];
  if (w.player.copper < def.vendorCopper) { log(w, 'error', 'You do not have enough money.'); return false; }
  const inst: ItemInstance = { itemId, count: 1, ...(def.maxDurability ? { durability: def.maxDurability } : {}) };
  if (!addItem(w, inst)) return false;
  w.player.copper -= def.vendorCopper;
  log(w, 'money', `Bought ${def.name} for ${money(def.vendorCopper)}.`);
  return true;
}

export function repairAll(w: World): boolean {
  let cost = 0;
  const all = [...Object.values(w.player.equipped), ...w.player.bags].filter(Boolean) as ItemInstance[];
  for (const inst of all) {
    const def = ITEMS[inst.itemId];
    if (!def.maxDurability || inst.durability === undefined) continue;
    cost += (def.maxDurability - inst.durability) * F.REPAIR_COPPER_PER_POINT;
  }
  if (cost === 0) { log(w, 'system', 'Nothing needs repair.'); return true; }
  if (w.player.copper < cost) { log(w, 'error', `Repairs cost ${money(cost)}.`); return false; }
  w.player.copper -= cost;
  for (const inst of all) {
    const def = ITEMS[inst.itemId];
    if (def.maxDurability) inst.durability = def.maxDurability;
  }
  log(w, 'money', `Repaired all items for ${money(cost)}.`);
  recomputeGear(w);
  return true;
}

export function damageDurabilityOnDeath(w: World) {
  for (const inst of Object.values(w.player.equipped)) {
    if (!inst || inst.durability === undefined) continue;
    const max = ITEMS[inst.itemId].maxDurability!;
    inst.durability = Math.max(0, Math.floor(inst.durability - max * F.DURABILITY_LOSS_ON_DEATH));
  }
  recomputeGear(w);
}

export function money(copper: number): string {
  const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
  return [g ? `${g}g` : '', s || g ? `${s}s` : '', `${c}c`].filter(Boolean).join(' ');
}
