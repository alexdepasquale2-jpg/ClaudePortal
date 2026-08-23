import { INTERACT_RANGE_YD, LOOT_RANGE_YD } from '../data/formulas';
import { dist } from '../sim/world';
import { buildChat } from './chat';
import { buildActionBar } from './actionBar';
import { buildBags } from './bags';
import { buildCharSheet } from './charSheet';
import { buildFrames } from './unitFrames';
import { buildMinimap } from './minimap';
import { buildQuestLog } from './questLog';
import { buildDialog, buildLoot, buildSpellbook, buildTalents } from './panels';
import { el, show } from './store';
import { Nameplates } from '../render/nameplates';
import { FloatingText } from '../render/fct';
import type { Ctx } from './ctx';
import type { Renderer } from '../render/scene';
import type { CommandQueue } from '../net/queue';
import type { World } from '../sim/types';

export function buildHud(world: World, queue: CommandQueue, renderer: Renderer) {
  const root = el('div#ui');
  document.body.append(root);
  const open = new Set<string>();

  const ctx: Ctx = {
    world, queue, renderer, root,
    send: c => queue.push(c),
    openPanel: n => { open.add(n); sync(n); },
    closePanel: n => { open.delete(n); sync(n); },
    isOpen: n => open.has(n),
  };

  const frames = buildFrames(ctx);
  const bar = buildActionBar(ctx);
  const chat = buildChat(ctx);
  const bags = buildBags(ctx);
  const sheet = buildCharSheet(ctx);
  const quests = buildQuestLog(ctx);
  const minimap = buildMinimap(ctx);
  const dialog = buildDialog(ctx);
  const loot = buildLoot(ctx);
  const talents = buildTalents(ctx);
  const spellbook = buildSpellbook(ctx);
  const plates = new Nameplates(root, renderer);
  const floats = new FloatingText(root, renderer);

  function sync(name: string) {
    const on = open.has(name);
    if (name === 'bags') bags.toggle(on);
    if (name === 'char') sheet.toggle(on);
    if (name === 'quests') quests.toggle(on);
    if (name === 'talents') talents.toggle(on);
    if (name === 'spells') spellbook.toggle(on);
  }
  const toggle = (n: string) => (open.has(n) ? ctx.closePanel(n) : ctx.openPanel(n));

  const micro = el('div#micro', {},
    el('button', { onclick: () => toggle('char'), title: 'Character (C)' }, 'Char'),
    el('button', { onclick: () => toggle('spells'), title: 'Spellbook (P)' }, 'Spells'),
    el('button', { onclick: () => toggle('talents'), title: 'Talents (N)' }, 'Talents'),
    el('button', { onclick: () => toggle('quests'), title: 'Quest Log (L)' }, 'Quests'),
    el('button', { onclick: () => toggle('bags'), title: 'Bags (B)' }, 'Bags'));
  root.append(micro);

  const deathPanel = el('div.panel.hidden#death', {},
    el('h3', {}, 'You have died'),
    el('button', { onclick: () => ctx.send({ t: 'revive' }) }, 'Release spirit'));
  root.append(deathPanel);

  /** One interaction verb for click and tap alike: target, then talk or loot if close enough. */
  function interact(unitId: number | null) {
    if (unitId === null) { ctx.send({ t: 'target', id: null }); return; }
    const u = world.units.get(unitId);
    if (!u) return;
    ctx.send({ t: 'target', id: unitId });
    const p = world.units.get(world.player.unitId)!;
    const d = dist(p.pos, u.pos);
    if (u.kind === 'npc' && d <= INTERACT_RANGE_YD && u.npcDefId) dialog.open(u.npcDefId);
    else if (u.dead && d <= LOOT_RANGE_YD) loot.openNearest();
  }

  function targetNearest() {
    const p = world.units.get(world.player.unitId)!;
    let best: { id: number; d: number } | null = null;
    for (const u of world.units.values()) {
      if (u.kind !== 'mob' || u.dead || u.id === p.targetId) continue;
      const d = dist(p.pos, u.pos);
      if (d < 45 && (!best || d < best.d)) best = { id: u.id, d };
    }
    if (best) ctx.send({ t: 'target', id: best.id });
  }

  addEventListener('keydown', e => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'b') toggle('bags');
    else if (k === 'c') toggle('char');
    else if (k === 'l') toggle('quests');
    else if (k === 'n') toggle('talents');
    else if (k === 'p') toggle('spells');
    else if (k === 'tab') { e.preventDefault(); targetNearest(); }
    else if (k === 'f') interactNearest();
    else if (k === 'escape') { for (const n of [...open]) ctx.closePanel(n); dialog.close(); }
    else return;
    e.preventDefault();
  });

  /** F is the "do the obvious thing" key: loot a corpse, or talk to the NPC you are standing next to. */
  function interactNearest() {
    if (loot.openNearest()) return;
    const p = world.units.get(world.player.unitId)!;
    for (const u of world.units.values())
      if (u.kind === 'npc' && dist(p.pos, u.pos) <= INTERACT_RANGE_YD) { interact(u.id); return; }
  }

  return {
    ctx, interact, targetNearest, interactNearest,
    useAction: (i: number) => bar.use(i),
    update() {
      const p = world.units.get(world.player.unitId)!;
      show(deathPanel, p.dead);
      frames.update(); bar.update(); chat.update(); bags.update(); sheet.update();
      quests.update(); minimap.update(); loot.update();
      plates.update(world);
      floats.spawn(world);
      floats.update();
    },
  };
}
