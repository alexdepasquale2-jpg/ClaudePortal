import { el } from './store';
import type { Ctx } from './ctx';

const FILTERS: Record<string, string[]> = {
  All: [],
  Combat: ['dmg-out', 'dmg-in', 'miss', 'heal', 'dot', 'death', 'cast'],
  Loot: ['loot', 'money', 'xp', 'level'],
  Quest: ['quest', 'system'],
};

/** The combat log is the debug tool: it prints real numbers for every roll the sim makes. */
export function buildChat(ctx: Ctx) {
  let filter = 'All';
  const lines = el('div#chatLines');
  const tabs = el('div#chatTabs');
  const buttons = Object.keys(FILTERS).map(name => {
    const b = el('button', { onclick: () => { filter = name; buttons.forEach(x => x.classList.toggle('on', x.textContent === filter)); render(true); } }, name);
    if (name === filter) b.classList.add('on');
    return b;
  });
  tabs.append(...buttons);
  const box = el('div#chat', {}, tabs, lines);
  ctx.root.append(box);

  let drawn = 0;
  function render(force = false) {
    const log = ctx.world.log;
    if (force) { lines.textContent = ''; drawn = 0; }
    if (drawn > log.length) { lines.textContent = ''; drawn = 0; }
    const kinds = FILTERS[filter];
    const atBottom = lines.scrollTop + lines.clientHeight >= lines.scrollHeight - 24;
    for (; drawn < log.length; drawn++) {
      const l = log[drawn];
      if (kinds.length && !kinds.includes(l.kind)) continue;
      lines.append(el('div', { class: `k-${l.kind}` }, l.text));
    }
    while (lines.childElementCount > 200) lines.firstElementChild!.remove();
    if (atBottom) lines.scrollTop = lines.scrollHeight;
  }
  return { update: () => render(false) };
}
