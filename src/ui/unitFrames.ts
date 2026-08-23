import { AURAS } from '../data/auras';
import { SPELLS } from '../data/spells';
import { TICK_MS } from '../data/formulas';
import { xpToNext } from '../sim/xp';
import { levelColor } from '../render/nameplates';
import { el, show } from './store';
import type { Ctx } from './ctx';
import type { Unit, World } from '../sim/types';

function frame(id: string, onClick?: () => void) {
  const node = el(`div.unitframe#${id}`, onClick ? { onclick: onClick } : {},
    el('div.portrait'),
    el('div.uf-body', {},
      el('div.uf-name', {}, el('span.n'), el('span.lv')),
      el('div.bar.hp', {}, el('i'), el('span')),
      el('div.bar.power', {}, el('i'), el('span')),
      el('div.auras')));
  return node;
}

function paint(node: HTMLElement, u: Unit, w: World, hostile: boolean) {
  const [portrait, body] = [node.children[0] as HTMLElement, node.children[1] as HTMLElement];
  const nameRow = body.children[0] as HTMLElement;
  const hp = body.children[1] as HTMLElement;
  const power = body.children[2] as HTMLElement;
  const auras = body.children[3] as HTMLElement;
  const player = w.units.get(w.player.unitId)!;

  portrait.textContent = u.name.slice(0, 2).toUpperCase();
  portrait.style.background = hostile ? '#4a1e1e' : '#1e2a4a';
  (nameRow.children[0] as HTMLElement).textContent = u.name;
  const lv = nameRow.children[1] as HTMLElement;
  lv.textContent = String(u.level);
  lv.style.color = levelColor(player.level, u.level);

  hp.classList.toggle('hostile', hostile);
  (hp.firstElementChild as HTMLElement).style.width = `${(u.health / u.maxHealth) * 100}%`;
  (hp.lastElementChild as HTMLElement).textContent = `${Math.ceil(u.health)} / ${u.maxHealth}`;

  const showPower = u.powerType !== 'none' && u.maxPower > 0;
  show(power, showPower);
  if (showPower) {
    power.className = `bar power ${u.powerType}`;
    (power.firstElementChild as HTMLElement).style.width = `${(u.power / u.maxPower) * 100}%`;
    (power.lastElementChild as HTMLElement).textContent = `${Math.floor(u.power)} / ${u.maxPower}`;
  }

  const key = u.auras.map(a => `${a.defId}${a.stacks}`).join(',');
  if (auras.dataset.key !== key) {
    auras.dataset.key = key;
    auras.textContent = '';
    for (const a of u.auras) {
      const def = AURAS[a.defId];
      const chip = el('div.aura', { title: def.name }, def.icon);
      if (!def.helpful) chip.classList.add('debuff');
      if (a.stacks > 1) chip.append(el('b', {}, String(a.stacks)));
      auras.append(chip);
    }
  }
}

export function buildFrames(ctx: Ctx) {
  const playerFrame = frame('playerFrame');
  const targetFrame = frame('targetFrame', () => {
    const t = ctx.world.units.get(ctx.world.player.unitId)!.targetId;
    if (t) ctx.send({ t: 'target', id: t });
  });
  const castBar = el('div.bar.cast', {}, el('i'), el('span'));
  const castWrap = el('div#castBarWrap.hidden', {}, castBar);
  const xpFill = el('i'), xpRested = el('div.rested'), xpText = el('span');
  const xpBar = el('div.bar.xp#xpBar', {}, xpRested, xpFill, xpText);
  ctx.root.append(playerFrame, targetFrame, castWrap, xpBar);

  return {
    update() {
      const w = ctx.world;
      const p = w.units.get(w.player.unitId)!;
      paint(playerFrame, p, w, false);
      const t = p.targetId ? w.units.get(p.targetId) : null;
      show(targetFrame, !!t);
      if (t) paint(targetFrame, t, w, t.kind === 'mob');

      const caster = p.casting ? p : t?.casting ? t : null;
      show(castWrap, !!caster?.casting);
      if (caster?.casting) {
        const sp = SPELLS[caster.casting.spellId];
        const total = sp.castMs / TICK_MS;
        const left = caster.casting.endTick - w.tick;
        const pct = Math.max(0, Math.min(1, 1 - left / total));
        (castBar.firstElementChild as HTMLElement).style.width = `${pct * 100}%`;
        (castBar.lastElementChild as HTMLElement).textContent = `${caster.name}: ${sp.name}`;
      }

      const need = xpToNext(p.level);
      xpFill.style.width = `${Math.min(100, (w.player.xp / need) * 100)}%`;
      xpRested.style.width = `${Math.min(100, ((w.player.xp + w.player.restedXp) / need) * 100)}%`;
      xpText.textContent = p.level >= 10
        ? `Level ${p.level} — zone cap`
        : `${w.player.xp} / ${need} XP${w.player.restedXp > 0 ? ' (Rested)' : ''}`;
    },
  };
}
