import { QUESTS } from '../data/quests';
import { ITEMS } from '../data/items';
import { addItem, countItem, money, removeItem } from './inventory';
import { grantXp } from './xp';
import { dist, log, makeItem } from './world';
import type { QuestDef, QuestState, World } from './types';

export const questState = (w: World, id: string) => w.player.quests.find(q => q.id === id);

export function questAvailable(w: World, id: string): boolean {
  const q = QUESTS[id];
  if (!q) return false;
  if (w.player.completedQuests.includes(id)) return false;
  if (questState(w, id)) return false;
  const p = w.units.get(w.player.unitId)!;
  if (p.level + 3 < q.level) return false;
  return (q.prereq ?? []).every(pr => w.player.completedQuests.includes(pr));
}

export function questsFor(w: World, npcId: string) {
  const offer = Object.values(QUESTS).filter(q => q.giver === npcId && questAvailable(w, q.id));
  const turnIn = w.player.quests.filter(q => QUESTS[q.id].turnIn === npcId && !q.turnedIn);
  return { offer, turnIn };
}

export function acceptQuest(w: World, id: string): boolean {
  if (!questAvailable(w, id)) return false;
  const q = QUESTS[id];
  w.player.quests.push({ id, progress: q.objectives.map(() => 0), complete: false, turnedIn: false });
  log(w, 'quest', `Quest accepted: ${q.name}`);
  refreshQuest(w, id);
  return true;
}

export function abandonQuest(w: World, id: string) {
  w.player.quests = w.player.quests.filter(q => q.id !== id);
  log(w, 'quest', `Quest abandoned: ${QUESTS[id].name}`);
}

export function onKill(w: World, mobId: string) {
  for (const st of w.player.quests) {
    if (st.turnedIn) continue;
    const q = QUESTS[st.id];
    q.objectives.forEach((o, i) => {
      if (o.kind === 'kill' && o.mobId === mobId && st.progress[i] < o.count) {
        st.progress[i]++;
        log(w, 'quest', `${o.text}: ${st.progress[i]}/${o.count}`);
      }
    });
    checkComplete(w, st);
  }
}

export function onTalk(w: World, npcId: string) {
  for (const st of w.player.quests) {
    if (st.turnedIn) continue;
    QUESTS[st.id].objectives.forEach((o, i) => {
      if (o.kind === 'talk' && o.npcId === npcId && !st.progress[i]) {
        st.progress[i] = 1;
        log(w, 'quest', `${o.text}: done`);
      }
    });
    checkComplete(w, st);
  }
}

export function refreshQuest(w: World, id: string) {
  const st = questState(w, id); if (!st) return;
  const p = w.units.get(w.player.unitId)!;
  QUESTS[id].objectives.forEach((o, i) => {
    if (o.kind === 'collect') st.progress[i] = Math.min(o.count, countItem(w, o.itemId));
    if (o.kind === 'explore' && !st.progress[i] && dist(p.pos, { x: o.x, z: o.z }) <= o.radius) {
      st.progress[i] = 1;
      log(w, 'quest', `${o.text}: discovered`);
    }
  });
  checkComplete(w, st);
}

export function refreshAllQuests(w: World) { for (const q of w.player.quests) refreshQuest(w, q.id); }

function objectiveDone(q: QuestDef, st: QuestState, i: number): boolean {
  const o = q.objectives[i];
  const need = o.kind === 'kill' || o.kind === 'collect' ? o.count : 1;
  return st.progress[i] >= need;
}

function checkComplete(w: World, st: QuestState) {
  const q = QUESTS[st.id];
  const done = q.objectives.every((_, i) => objectiveDone(q, st, i));
  if (done && !st.complete) { st.complete = true; log(w, 'quest', `${q.name} (Complete)`); }
  if (!done) st.complete = false;
}

export function canTurnIn(w: World, id: string) {
  const st = questState(w, id);
  return !!st && st.complete && !st.turnedIn;
}

export function completeQuest(w: World, id: string, choiceItemId?: string): boolean {
  if (!canTurnIn(w, id)) return false;
  const q = QUESTS[id];
  for (const o of q.objectives) if (o.kind === 'collect') removeItem(w, o.itemId, o.count);

  w.player.copper += q.rewards.copper;
  for (const itemId of q.rewards.items ?? []) addItem(w, makeItem(w, itemId));
  if (choiceItemId && (q.rewards.choice ?? []).includes(choiceItemId)) addItem(w, makeItem(w, choiceItemId));

  w.player.quests = w.player.quests.filter(x => x.id !== id);
  w.player.completedQuests.push(id);
  log(w, 'quest', `Quest complete: ${q.name}. You receive ${money(q.rewards.copper)}.`);
  grantXp(w, q.rewards.xp, q.name);
  w.events.push(`questdone:${id}`);
  refreshAllQuests(w);
  return true;
}

export function objectiveText(w: World, id: string): string[] {
  const st = questState(w, id); const q = QUESTS[id];
  if (!st) return [];
  return q.objectives.map((o, i) => {
    const need = o.kind === 'kill' || o.kind === 'collect' ? o.count : 1;
    const label = o.kind === 'collect' ? ITEMS[o.itemId].name : o.text;
    return need > 1 ? `${label}: ${st.progress[i]}/${need}` : `${label}${st.progress[i] ? ' (done)' : ''}`;
  });
}
