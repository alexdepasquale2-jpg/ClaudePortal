import { ITEMS, QUALITY_COLOR, SUFFIXES } from '../data/items';
import { SPELLS } from '../data/spells';
import { money } from '../sim/inventory';
import { el } from './store';
import type { Ctx } from './ctx';
import type { ItemInstance } from '../sim/types';

let tip: HTMLElement | null = null;
function node() {
  if (!tip) { tip = el('div.panel.hidden#tooltip'); document.getElementById('ui')!.append(tip); }
  return tip;
}

export function attachTooltip(host: HTMLElement, build: () => HTMLElement | null) {
  const move = (e: MouseEvent) => {
    const t = node();
    t.style.left = `${Math.min(innerWidth - 270, e.clientX + 14)}px`;
    t.style.top = `${Math.min(innerHeight - 180, e.clientY + 14)}px`;
  };
  host.addEventListener('mouseenter', e => {
    const content = build();
    const t = node();
    if (!content) { t.classList.add('hidden'); return; }
    t.textContent = ''; t.append(content); t.classList.remove('hidden');
    move(e as MouseEvent);
  });
  host.addEventListener('mousemove', move);
  host.addEventListener('mouseleave', () => node().classList.add('hidden'));
}

export function spellTooltip(ctx: Ctx, spellId: string): HTMLElement {
  const sp = SPELLS[spellId];
  const rows: (Node | string)[] = [el('div.t-name', { style: { color: '#ffd100' } }, sp.name)];
  if (sp.cost) rows.push(el('div.muted', {}, `${sp.cost} ${sp.resource}`));
  rows.push(el('div.muted', {}, sp.castMs ? `${(sp.castMs / 1000).toFixed(1)} sec cast` : 'Instant'));
  if (sp.cooldownMs) rows.push(el('div.muted', {}, `${sp.cooldownMs / 1000} sec cooldown`));
  if (sp.rangeYd) rows.push(el('div.muted', {}, `${sp.rangeYd} yd range`));
  rows.push(el('div', {}, sp.desc));
  return el('div', {}, ...rows);
}

export function itemTooltip(inst: ItemInstance): HTMLElement {
  const def = ITEMS[inst.itemId];
  const name = inst.suffixId ? `${def.name} ${SUFFIXES[inst.suffixId].name}` : def.name;
  const rows: (Node | string)[] = [el('div.t-name', { style: { color: QUALITY_COLOR[def.quality] } }, name)];
  if (def.weapon) {
    rows.push(el('div', {}, `${def.weapon.min} - ${def.weapon.max} Damage`));
    rows.push(el('div.muted', {}, `Speed ${(def.weapon.speedMs / 1000).toFixed(2)}`));
    const dps = ((def.weapon.min + def.weapon.max) / 2) / (def.weapon.speedMs / 1000);
    rows.push(el('div.muted', {}, `(${dps.toFixed(1)} damage per second)`));
  }
  const stats: Record<string, number> = { ...(def.stats ?? {}) } as never;
  if (inst.suffixId) for (const [k, v] of Object.entries(SUFFIXES[inst.suffixId].stats)) stats[k] = (stats[k] ?? 0) + v;
  for (const [k, v] of Object.entries(stats)) rows.push(el('div', { style: { color: '#7fff9a' } }, `+${v} ${label(k)}`));
  if (inst.durability !== undefined) rows.push(el('div.muted', {}, `Durability ${inst.durability} / ${def.maxDurability}`));
  if (def.desc) rows.push(el('div', { style: { color: '#ffd100' } }, `"${def.desc}"`));
  rows.push(el('div.muted', {}, `Sell price: ${money(Math.max(1, Math.floor(def.vendorCopper * 0.25)))}`));
  return el('div', {}, ...rows);
}

const label = (k: string) => ({ str: 'Strength', agi: 'Agility', sta: 'Stamina', int: 'Intellect', spi: 'Spirit', ap: 'Attack Power', crit: '% Crit', armor: 'Armor', spellPower: 'Spell Power' } as Record<string, string>)[k] ?? k;
