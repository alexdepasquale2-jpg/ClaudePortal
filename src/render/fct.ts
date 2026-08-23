import { el } from '../ui/store';
import type { Renderer } from './scene';
import type { World } from '../sim/types';

/** Pooled floating combat text. Nodes are reused; nothing is allocated per hit. */
export class FloatingText {
  private pool: HTMLElement[] = [];
  private live: { node: HTMLElement; unitId: number; born: number; dy: number }[] = [];
  private layer = el('div#floats');
  constructor(root: HTMLElement, private renderer: Renderer, size = 48) {
    root.append(this.layer);
    for (let i = 0; i < size; i++) {
      const n = el('div.float');
      n.style.display = 'none';
      this.layer.append(n);
      this.pool.push(n);
    }
  }
  spawn(w: World) {
    for (const f of w.floats) {
      const node = this.pool.pop();
      if (!node) return;
      node.className = `float ${f.kind}`;
      node.textContent = f.text;
      node.style.display = '';
      node.style.animation = 'none';
      void node.offsetWidth;
      node.style.animation = '';
      this.live.push({ node, unitId: f.unitId, born: performance.now(), dy: (Math.random() - 0.5) * 26 });
    }
  }
  update() {
    const now = performance.now();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      if (now - f.born > 1150) {
        f.node.style.display = 'none';
        this.pool.push(f.node);
        this.live.splice(i, 1);
        continue;
      }
      const p = this.renderer.unitScreenPos(f.unitId, 0.4);
      if (!p || !p.visible) { f.node.style.display = 'none'; continue; }
      f.node.style.display = '';
      f.node.style.left = `${p.x + f.dy}px`;
      f.node.style.top = `${p.y}px`;
    }
  }
}
