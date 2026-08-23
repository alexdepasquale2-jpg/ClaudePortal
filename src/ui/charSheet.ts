import { CLASSES } from '../data/classes';
import { ITEMS, QUALITY_COLOR } from '../data/items';
import * as F from '../data/formulas';
import { weaponOf } from '../sim/combat';
import { effStats, itemName } from '../sim/world';
import { money } from '../sim/inventory';
import { el, show } from './store';
import { attachTooltip, itemTooltip } from './tooltip';
import type { Ctx } from './ctx';
import type { Slot } from '../sim/types';

const SLOTS: Slot[] = ['head', 'chest', 'legs', 'feet', 'hands', 'mainhand', 'offhand', 'ranged', 'trinket'];

/** Every number here reads live off the sim's effective-stat function — no cached copies. */
export function buildCharSheet(ctx: Ctx) {
  const gear = el('div.grid', { style: { gridTemplateColumns: 'repeat(5, 42px)' } });
  const stats = el('div');
  const panel = el('div.panel.hidden#charSheet', {},
    el('h3', {}, 'Character', el('span.close', { onclick: () => ctx.closePanel('char') }, '✕')),
    gear, el('div', { style: { height: '6px' } }), stats);
  ctx.root.append(panel);

  const cells = SLOTS.map(slot => {
    const c = el('div.cell', { title: slot, onclick: () => ctx.send({ t: 'unequip', slot }) });
    attachTooltip(c, () => {
      const inst = ctx.world.player.equipped[slot];
      return inst ? itemTooltip(inst) : null;
    });
    return c;
  });
  gear.append(...cells);

  const row = (k: string, v: string) => el('div.statrow', {}, el('span', {}, k), el('span', {}, v));

  return {
    panel,
    update() {
      if (panel.classList.contains('hidden')) return;
      SLOTS.forEach((slot, i) => {
        const inst = ctx.world.player.equipped[slot];
        const c = cells[i];
        c.textContent = inst ? ITEMS[inst.itemId].icon : slot.slice(0, 3);
        c.style.color = inst ? QUALITY_COLOR[ITEMS[inst.itemId].quality] : '#555';
        c.style.borderColor = inst ? QUALITY_COLOR[ITEMS[inst.itemId].quality] : '#333';
        c.title = inst ? itemName(inst) : slot;
      });

      const w = ctx.world;
      const p = w.units.get(w.player.unitId)!;
      const s = effStats(w, p);
      const wep = weaponOf(w, p);
      const dps = ((wep.min + wep.max) / 2 + (s.ap / F.AP_TO_DPS) * (wep.speedMs / 1000)) / (wep.speedMs / 1000);
      stats.textContent = '';
      stats.append(
        row('Class', `${CLASSES[p.classId].name} — Level ${p.level}`),
        row('Strength', String(s.str)), row('Agility', String(s.agi)), row('Stamina', String(s.sta)),
        row('Intellect', String(s.int)), row('Spirit', String(s.spi)),
        row('Health', `${Math.ceil(p.health)} / ${p.maxHealth}`),
        row(p.powerType === 'rage' ? 'Rage' : 'Mana', `${Math.floor(p.power)} / ${p.maxPower}`),
        row('Attack Power', String(Math.floor(s.ap))),
        row('Damage', `${wep.min}-${wep.max} @ ${(wep.speedMs / 1000).toFixed(1)}s (${dps.toFixed(1)} dps)`),
        row('Melee Crit', `${(F.critFrom(s.agi) + s.crit).toFixed(2)}%`),
        row('Spell Crit', `${F.spellCritFrom(s.int).toFixed(2)}%`),
        row('Spell Power', String(Math.floor(s.spellPower))),
        row('Armor', `${Math.floor(s.armor)} (${(F.armorDR(s.armor, p.level) * 100).toFixed(1)}% vs level ${p.level})`),
        row('Dodge', `${F.dodgeFrom(s.agi).toFixed(2)}%`),
        row('Money', money(w.player.copper)),
      );
    },
    toggle: (on: boolean) => show(panel, on),
  };
}
