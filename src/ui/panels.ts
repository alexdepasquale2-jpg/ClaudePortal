import { CLASSES } from '../data/classes';
import { ITEMS, QUALITY_COLOR } from '../data/items';
import { QUESTS } from '../data/quests';
import { SPELLS } from '../data/spells';
import { STARTER_ZONE } from '../data/zone.starter';
import { TALENTS, treesFor } from '../data/talents';
import { money } from '../sim/inventory';
import { lootableCorpses } from '../sim/loot';
import { objectiveText, questsFor } from '../sim/quests';
import { itemName } from '../sim/world';
import { el, show } from './store';
import { attachTooltip, itemTooltip, spellTooltip } from './tooltip';
import type { Ctx } from './ctx';

/** One dialog window serves quests, vendors and trainers — NPCs just have different role tabs. */
export function buildDialog(ctx: Ctx) {
  const body = el('div');
  const panel = el('div.panel.hidden#dialog', {},
    el('h3', {}, el('span.title'), el('span.close', { onclick: () => close() }, '✕')),
    body);
  ctx.root.append(panel);
  let npcId: string | null = null;
  let view: 'root' | 'quest' | 'vendor' | 'trainer' = 'root';
  let questId: string | null = null;

  const close = () => { npcId = null; show(panel, false); ctx.closePanel('vendor'); };

  function open(id: string) {
    npcId = id; view = 'root'; questId = null;
    ctx.send({ t: 'talk', npcId: id });
    render();
    show(panel, true);
  }

  function render() {
    if (!npcId) return;
    const def = STARTER_ZONE.npcs.find(n => n.id === npcId)!;
    (panel.querySelector('.title') as HTMLElement).textContent = `${def.name}${def.title ? ` — ${def.title}` : ''}`;
    body.textContent = '';
    show(panel, true);
    ctx[def.roles.includes('vendor') && view === 'vendor' ? 'openPanel' : 'closePanel']('vendor');

    if (view === 'quest' && questId) return renderQuest(questId);
    if (view === 'vendor') return renderVendor(def.vendorItems ?? []);
    if (view === 'trainer') return renderTrainer();

    const { offer, turnIn } = questsFor(ctx.world, npcId);
    for (const st of turnIn) {
      const q = QUESTS[st.id];
      body.append(el('div.listrow', {},
        el('span', { style: { color: st.complete ? '#ffd100' : '#aaa' } }, `${st.complete ? '?' : '·'} ${q.name}`),
        el('button', { onclick: () => { questId = q.id; view = 'quest'; render(); } }, st.complete ? 'Turn in' : 'Progress')));
    }
    for (const q of offer) {
      body.append(el('div.listrow', {},
        el('span', { style: { color: '#ffd100' } }, `! ${q.name}`),
        el('button', { onclick: () => { questId = q.id; view = 'quest'; render(); } }, 'Read')));
    }
    if (def.roles.includes('vendor')) body.append(el('button', { onclick: () => { view = 'vendor'; render(); } }, 'Browse goods'));
    if (def.roles.includes('trainer')) body.append(el('button', { onclick: () => { view = 'trainer'; render(); } }, 'Train abilities'));
    if (def.roles.includes('innkeeper')) {
      body.append(el('button', { onclick: () => { ctx.send({ t: 'rest', on: true }); close(); } }, 'Rest at the inn'));
      body.append(el('div.muted', {}, 'Resting builds rested experience. Moving ends it.'));
    }
    if (!body.childElementCount) body.append(el('div.muted', {}, 'They have nothing for you right now.'));
  }

  function renderQuest(id: string) {
    const q = QUESTS[id];
    const st = ctx.world.player.quests.find(x => x.id === id);
    body.append(el('h3', {}, q.name));
    body.append(el('p', {}, st ? (st.complete ? q.completeText : q.progressText) : q.text));
    if (st) for (const line of objectiveText(ctx.world, id)) body.append(el('div.muted', {}, line));
    body.append(el('div.muted', {}, `Rewards: ${q.rewards.xp} XP, ${money(q.rewards.copper)}`));
    for (const itemId of q.rewards.items ?? []) body.append(el('div', {}, `Receives: ${ITEMS[itemId].name}`));

    let choice: string | null = null;
    if (q.rewards.choice?.length) {
      body.append(el('div.muted', {}, 'Choose one:'));
      const btns = q.rewards.choice.map(itemId => {
        const b = el('button', {
          style: { color: QUALITY_COLOR[ITEMS[itemId].quality] },
          onclick: () => { choice = itemId; btns.forEach(x => x.style.outline = ''); b.style.outline = '2px solid #ffd100'; },
        }, ITEMS[itemId].name);
        attachTooltip(b, () => itemTooltip({ itemId, count: 1 }));
        return b;
      });
      body.append(el('div', {}, ...btns));
    }

    const actions = el('div', { style: { marginTop: '8px' } });
    if (!st) actions.append(el('button', { onclick: () => { ctx.send({ t: 'acceptQuest', questId: id }); view = 'root'; render(); } }, 'Accept'));
    else if (st.complete) actions.append(el('button', {
      onclick: () => {
        if (q.rewards.choice?.length && !choice) return;
        ctx.send({ t: 'completeQuest', questId: id, choice: choice ?? undefined });
        view = 'root'; setTimeout(render, 0);
      },
    }, 'Complete quest'));
    actions.append(el('button', { onclick: () => { view = 'root'; render(); } }, 'Back'));
    body.append(actions);
  }

  function renderVendor(items: string[]) {
    body.append(el('div.muted', {}, `Your purse: ${money(ctx.world.player.copper)}`));
    for (const itemId of items) {
      const def = ITEMS[itemId];
      const row = el('div.listrow', {},
        el('span', { style: { color: QUALITY_COLOR[def.quality] } }, `${def.icon} ${def.name}`),
        el('button', { onclick: () => { ctx.send({ t: 'buy', itemId }); setTimeout(render, 0); } }, money(def.vendorCopper)));
      attachTooltip(row, () => itemTooltip({ itemId, count: 1 }));
      body.append(row);
    }
    body.append(el('button', { onclick: () => { ctx.send({ t: 'repair' }); setTimeout(render, 0); } }, 'Repair all'));
    body.append(el('div.muted', {}, 'Open your bags (B) and click an item to sell it.'));
    body.append(el('button', { onclick: () => { view = 'root'; render(); } }, 'Back'));
  }

  function renderTrainer() {
    const w = ctx.world;
    const p = w.units.get(w.player.unitId)!;
    const list = Object.values(SPELLS).filter(s => s.classId === p.classId && !w.player.knownSpells.includes(s.id));
    body.append(el('div.muted', {}, `${CLASSES[p.classId].name} abilities — your purse: ${money(w.player.copper)}`));
    if (!list.length) body.append(el('div.muted', {}, 'You know everything they can teach.'));
    for (const sp of list) {
      const affordable = p.level >= sp.reqLevel && w.player.copper >= (sp.trainCostCopper ?? 0);
      const row = el('div.listrow', {},
        el('span', {}, `${sp.icon} ${sp.name} (level ${sp.reqLevel})`),
        el('button', {
          disabled: affordable ? null : 'true',
          onclick: () => { ctx.send({ t: 'train', spellId: sp.id }); setTimeout(render, 0); },
        }, money(sp.trainCostCopper ?? 0)));
      attachTooltip(row, () => spellTooltip(ctx, sp.id));
      body.append(row);
    }
    body.append(el('button', { onclick: () => { view = 'root'; render(); } }, 'Back'));
  }

  return { open, close, isOpen: () => !panel.classList.contains('hidden'), refresh: () => { if (npcId) render(); } };
}

export function buildLoot(ctx: Ctx) {
  const body = el('div');
  const panel = el('div.panel.hidden#loot', {},
    el('h3', {}, 'Loot', el('span.close', { onclick: () => show(panel, false) }, '✕')), body);
  ctx.root.append(panel);
  let corpseId: number | null = null;

  function render(force = false) {
    const corpse = ctx.world.corpses.find(c => c.unitId === corpseId && !c.looted);
    if (!corpse) { show(panel, false); corpseId = null; return; }
    const key = `${corpse.copper}|${corpse.loot.map(i => i.itemId + i.count).join(',')}`;
    if (!force && body.dataset.key === key) return;
    body.dataset.key = key;
    body.textContent = '';
    if (corpse.copper) body.append(el('div.listrow', {},
      el('span.k-money', {}, money(corpse.copper)),
      el('button', { onclick: () => { ctx.send({ t: 'loot', corpseUnitId: corpse.unitId }); setTimeout(render, 60); } }, 'Take')));
    corpse.loot.forEach((inst, i) => {
      const def = ITEMS[inst.itemId];
      const row = el('div.listrow', {},
        el('span', { style: { color: QUALITY_COLOR[def.quality] } }, `${def.icon} ${itemName(inst)}${inst.count > 1 ? ` x${inst.count}` : ''}`),
        el('button', { onclick: () => { ctx.send({ t: 'lootSlot', corpseUnitId: corpse.unitId, index: i }); setTimeout(render, 60); } }, 'Take'));
      attachTooltip(row, () => itemTooltip(inst));
      body.append(row);
    });
    body.append(el('button', { onclick: () => { ctx.send({ t: 'loot', corpseUnitId: corpse.unitId }); setTimeout(render, 60); } }, 'Loot all'));
    show(panel, true);
  }

  return {
    openNearest() {
      const near = lootableCorpses(ctx.world);
      if (!near.length) return false;
      corpseId = near[0].unitId;
      render(true);
      return true;
    },
    update() { if (!panel.classList.contains('hidden')) render(); },
  };
}

export function buildTalents(ctx: Ctx) {
  const body = el('div');
  const panel = el('div.panel.hidden#talents', {},
    el('h3', {}, 'Talents', el('span.close', { onclick: () => ctx.closePanel('talents') }, '✕')), body);
  ctx.root.append(panel);

  function render() {
    const w = ctx.world;
    const p = w.units.get(w.player.unitId)!;
    body.textContent = '';
    body.append(el('div.muted', {}, `Unspent talent points: ${w.player.talentPoints} (the first arrives at level 10)`));
    const trees = treesFor(p.classId);
    const cols = el('div.trees');
    for (const [tree, list] of Object.entries(trees)) {
      const col = el('div.tree', {}, el('h3', {}, tree));
      for (const t of list) {
        const rank = w.player.talents[t.id] ?? 0;
        const reqMet = !t.requires || (w.player.talents[t.requires] ?? 0) > 0;
        const row = el('div.talent', {},
          t.requires ? el('span.arrow', { title: `Requires ${TALENTS[t.requires].name}` }, '↳') : el('span', {}, ' '),
          el('div.box', {
            onclick: () => {
              if (!reqMet || w.player.talentPoints <= 0 || rank >= t.maxRank) return;
              ctx.send({ t: 'spendTalent', talentId: t.id });
              setTimeout(render, 0);
            },
          }, `${rank}/${t.maxRank}`),
          el('div', {}, el('b', {}, t.name), el('div.muted', {}, t.desc)));
        if (!reqMet) row.classList.add('locked');
        col.append(row);
      }
      cols.append(col);
    }
    body.append(cols);
  }

  return { panel, render, toggle: (on: boolean) => { show(panel, on); if (on) render(); } };
}

/** Spellbook doubles as the drag source for action-bar slots. */
export function buildSpellbook(ctx: Ctx) {
  const body = el('div');
  const panel = el('div.panel.hidden#spellbook', {
    style: { left: '50%', top: '18%', transform: 'translateX(-50%)', width: 'min(360px, 92vw)' },
  }, el('h3', {}, 'Spellbook', el('span.close', { onclick: () => ctx.closePanel('spells') }, '✕')), body);
  ctx.root.append(panel);

  function render() {
    body.textContent = '';
    body.append(el('div.muted', {}, 'Drag a spell onto an action bar slot.'));
    for (const id of ctx.world.player.knownSpells) {
      const sp = SPELLS[id];
      const row = el('div.listrow', {
        draggable: 'true',
        ondragstart: (e: DragEvent) => e.dataTransfer!.setData('text/plain', `spell:${id}`),
      }, el('span', {}, `${sp.icon}  ${sp.name}`), el('span.muted', {}, sp.castMs ? `${sp.castMs / 1000}s` : 'Instant'));
      attachTooltip(row, () => spellTooltip(ctx, id));
      body.append(row);
    }
  }

  return { panel, render, toggle: (on: boolean) => { show(panel, on); if (on) render(); } };
}
