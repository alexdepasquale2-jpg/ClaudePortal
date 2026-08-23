import { SPELLS } from '../data/spells';
import { TICK_MS } from '../data/formulas';
import { canCast } from '../sim/spells';
import { el } from './store';
import { attachTooltip, spellTooltip } from './tooltip';
import type { Ctx } from './ctx';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/** Ten slots, keys 1-0, drag a spell from the spellbook or another slot to rearrange. */
export function buildActionBar(ctx: Ctx) {
  const bar = el('div#actionBar');
  const slots = KEYS.map((k, i) => {
    const s = el('div.slot', {
      draggable: 'true',
      onclick: () => use(i),
      ondragstart: (e: DragEvent) => e.dataTransfer!.setData('text/plain', `slot:${i}`),
      ondragover: (e: DragEvent) => { e.preventDefault(); s.classList.add('dragover'); },
      ondragleave: () => s.classList.remove('dragover'),
      ondrop: (e: DragEvent) => {
        e.preventDefault(); s.classList.remove('dragover');
        const data = e.dataTransfer!.getData('text/plain');
        if (data.startsWith('slot:')) {
          const from = Number(data.slice(5));
          const a = ctx.world.player.actionBar[from], b = ctx.world.player.actionBar[i];
          ctx.send({ t: 'setAction', index: i, spellId: a });
          ctx.send({ t: 'setAction', index: from, spellId: b });
        } else if (data.startsWith('spell:')) {
          ctx.send({ t: 'setAction', index: i, spellId: data.slice(6) });
        }
      },
    }, el('span.key', {}, k), el('span.icon'), el('div.cd.hidden'));
    attachTooltip(s, () => {
      const id = ctx.world.player.actionBar[i];
      return id ? spellTooltip(ctx, id) : null;
    });
    return s;
  });
  bar.append(...slots);
  ctx.root.append(bar);

  function use(i: number) {
    const id = ctx.world.player.actionBar[i];
    if (!id) return;
    const p = ctx.world.units.get(ctx.world.player.unitId)!;
    ctx.send({ t: 'cast', spellId: id, targetId: p.targetId });
  }

  addEventListener('keydown', e => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const i = KEYS.indexOf(e.key);
    if (i >= 0) { use(i); e.preventDefault(); }
  });

  return {
    use,
    update() {
      const w = ctx.world;
      const p = w.units.get(w.player.unitId)!;
      w.player.actionBar.forEach((id, i) => {
        const s = slots[i];
        const icon = s.children[1] as HTMLElement;
        const cd = s.children[2] as HTMLElement;
        if (!id) { icon.textContent = ''; cd.classList.add('hidden'); s.classList.remove('usable', 'active'); return; }
        const sp = SPELLS[id];
        icon.textContent = sp.icon;
        const ready = canCast(w, p, id, p.targetId) === null;
        s.classList.toggle('usable', ready);
        s.classList.toggle('active', id === 'attack' && p.attacking);
        const until = p.cooldowns[id] ?? 0;
        const left = (until - w.tick) * TICK_MS / 1000;
        cd.classList.toggle('hidden', left <= 0);
        if (left > 0) cd.textContent = left > 1 ? `${Math.ceil(left)}` : left.toFixed(1);
      });
    },
  };
}
