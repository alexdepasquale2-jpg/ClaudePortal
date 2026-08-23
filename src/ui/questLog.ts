import { QUESTS } from '../data/quests';
import { objectiveText } from '../sim/quests';
import { money } from '../sim/inventory';
import { el, show } from './store';
import type { Ctx } from './ctx';

export function buildQuestLog(ctx: Ctx) {
  const list = el('div');
  const panel = el('div.panel.hidden#questLog', {},
    el('h3', {}, 'Quest Log', el('span.close', { onclick: () => ctx.closePanel('quests') }, '✕')),
    list);
  ctx.root.append(panel);

  return {
    panel,
    update() {
      if (panel.classList.contains('hidden')) return;
      const w = ctx.world;
      const key = w.player.quests.map(q => `${q.id}:${q.progress.join('/')}:${q.complete}`).join('|');
      if (list.dataset.key === key) return;
      list.dataset.key = key;
      list.textContent = '';
      if (!w.player.quests.length) list.append(el('div.muted', {}, 'No active quests. Look for a ! over an NPC.'));
      for (const st of w.player.quests) {
        const q = QUESTS[st.id];
        const node = el('div.quest', {}, el('b', {}, `[${q.level}] ${q.name}`));
        if (st.complete) node.classList.add('complete');
        for (const line of objectiveText(w, st.id)) node.append(el('div.muted', {}, line));
        node.append(el('div.muted', {}, `Reward: ${q.rewards.xp} XP, ${money(q.rewards.copper)}`));
        node.append(el('button', { onclick: () => ctx.send({ t: 'abandonQuest', questId: st.id }) }, 'Abandon'));
        list.append(node);
      }
    },
    toggle: (on: boolean) => show(panel, on),
  };
}
