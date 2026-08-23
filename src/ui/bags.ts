import { ITEMS, QUALITY_COLOR } from '../data/items';
import { money } from '../sim/inventory';
import { itemName } from '../sim/world';
import { el, show } from './store';
import { attachTooltip, itemTooltip } from './tooltip';
import type { Ctx } from './ctx';

/** Bag grid. Left-click equips (or sells at a vendor); the panel doubles as the sell interface. */
export function buildBags(ctx: Ctx) {
  const grid = el('div.grid');
  const purse = el('div.muted');
  const panel = el('div.panel.hidden#bags', {},
    el('h3', {}, 'Backpack', el('span.close', { onclick: () => ctx.closePanel('bags') }, '✕')),
    grid, purse);
  ctx.root.append(panel);

  const cells = ctx.world.player.bags.map((_, i) => {
    const c = el('div.cell', {
      onclick: () => {
        const inst = ctx.world.player.bags[i];
        if (!inst) return;
        if (ctx.isOpen('vendor')) ctx.send({ t: 'sell', bagIndex: i });
        else ctx.send({ t: 'equip', bagIndex: i });
      },
    });
    attachTooltip(c, () => {
      const inst = ctx.world.player.bags[i];
      return inst ? itemTooltip(inst) : null;
    });
    return c;
  });
  grid.append(...cells);

  return {
    panel,
    update() {
      if (panel.classList.contains('hidden')) return;
      ctx.world.player.bags.forEach((inst, i) => {
        const c = cells[i];
        if (!inst) { c.textContent = ''; c.removeAttribute('style'); return; }
        const def = ITEMS[inst.itemId];
        c.textContent = def.icon;
        c.style.color = QUALITY_COLOR[def.quality];
        c.style.borderColor = QUALITY_COLOR[def.quality];
        c.title = itemName(inst);
        if (inst.count > 1) c.append(el('b', {}, String(inst.count)));
      });
      purse.textContent = `${money(ctx.world.player.copper)}${ctx.isOpen('vendor') ? ' — click an item to sell it' : ''}`;
    },
    toggle: (on: boolean) => show(panel, on),
  };
}
