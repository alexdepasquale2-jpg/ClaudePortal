import { el } from '../ui/store';
import { QUESTS } from '../data/quests';
import { questsFor } from '../sim/quests';
import type { Renderer } from './scene';
import type { World } from '../sim/types';

/** DOM nameplates, one pooled node per unit, plus ! / ? quest markers over NPCs. */
export class Nameplates {
  private nodes = new Map<number, HTMLElement>();
  private layer = el('div#plates');
  constructor(root: HTMLElement, private renderer: Renderer) { root.append(this.layer); }

  update(w: World) {
    const player = w.units.get(w.player.unitId)!;
    for (const [id, node] of this.nodes) if (!w.units.has(id)) { node.remove(); this.nodes.delete(id); }

    for (const u of w.units.values()) {
      if (u.id === player.id) continue;
      let node = this.nodes.get(u.id);
      if (!node) {
        node = el('div.plate', {}, el('div.mark'), el('div.pname'), el('div.pbar', {}, el('i')));
        this.layer.append(node);
        this.nodes.set(u.id, node);
      }
      const p = this.renderer.unitScreenPos(u.id, 0.3);
      const far = Math.hypot(u.pos.x - player.pos.x, u.pos.z - player.pos.z) > 60;
      if (u.dead || !p || !p.visible || far) { node.style.display = 'none'; continue; }
      node.style.display = '';
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
      node.classList.toggle('friendly', u.kind === 'npc');

      const mark = node.children[0] as HTMLElement;
      const name = node.children[1] as HTMLElement;
      const bar = node.children[2] as HTMLElement;
      (bar.firstElementChild as HTMLElement).style.width = `${(u.health / u.maxHealth) * 100}%`;
      bar.style.display = u.kind === 'npc' ? 'none' : '';
      name.textContent = u.kind === 'npc' ? u.name : `${u.name} (${u.level})`;
      name.style.color = u.kind === 'npc' ? '#ffd100' : levelColor(player.level, u.level);

      mark.textContent = u.kind === 'npc' ? questMark(w, u.npcDefId!) : '';
    }
  }
}

function questMark(w: World, npcId: string): string {
  const { offer, turnIn } = questsFor(w, npcId);
  if (turnIn.some(q => q.complete)) return '?';
  if (offer.length) return '!';
  if (turnIn.length) return '?';
  return '';
}

/** Classic's level colouring: red is dangerous, grey gives no experience. */
export function levelColor(playerLevel: number, level: number): string {
  const d = level - playerLevel;
  if (d >= 5) return '#ff2020';
  if (d >= 3) return '#ff7d0a';
  if (d >= -2) return '#ffff00';
  if (level > playerLevel - (5 + Math.floor(playerLevel / 10))) return '#40ff40';
  return '#9d9d9d';
}

export { QUESTS };
