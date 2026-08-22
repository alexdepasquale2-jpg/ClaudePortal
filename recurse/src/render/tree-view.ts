/**
 * tree-view.ts — a virtualized recursive tree.
 *
 * The tree can hold tens of thousands of nodes, so the DOM never holds more
 * than the rows actually on screen. Flattening is O(visible) rather than
 * O(all): a node's subtree is only walked when it is expanded, and the row
 * list is rebuilt only when the structure or the expansion set changes.
 */

import type { NodeData } from '../engine/procgen';
import { readableAccent, veil } from './palette';

export interface TreeRow {
  path: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

export interface TreeViewOptions {
  rowHeight: number;
  /** Rows rendered beyond the viewport, above and below. */
  overscan: number;
  onSelect(path: string): void;
  onToggle(path: string): void;
  /** Formatted right-hand column for a node. */
  detail(node: NodeData): string;
  /** Badge text (anomaly / tier), or ''. */
  badge(node: NodeData): string;
}

export class TreeView {
  private viewport: HTMLElement;
  private spacer: HTMLElement;
  private layer: HTMLElement;
  private rows: TreeRow[] = [];
  private pool: HTMLElement[] = [];
  private nodes: Record<string, NodeData> = {};
  private expanded: Record<string, 1> = {};
  private selected = '';
  private first = -1;
  private last = -1;
  private scrollRaf = 0;

  constructor(host: HTMLElement, private opts: TreeViewOptions) {
    host.classList.add('treeview');
    this.viewport = host;
    this.spacer = document.createElement('div');
    this.spacer.className = 'tree-spacer';
    this.layer = document.createElement('div');
    this.layer.className = 'tree-layer';
    this.spacer.appendChild(this.layer);
    host.appendChild(this.spacer);

    host.addEventListener('scroll', this.onScroll, { passive: true });
    host.addEventListener('click', this.onClick);
    host.addEventListener('keydown', this.onKeyDown);
    host.tabIndex = 0;
    host.setAttribute('role', 'tree');
    host.setAttribute('aria-label', 'Recursion tree');
  }

  destroy(): void {
    this.viewport.removeEventListener('scroll', this.onScroll);
    this.viewport.removeEventListener('click', this.onClick);
    this.viewport.removeEventListener('keydown', this.onKeyDown);
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
  }

  /** Rebuild the flattened row list. Call on structure or expansion change. */
  setTree(nodes: Record<string, NodeData>, expanded: Record<string, 1>, selected: string): void {
    this.nodes = nodes;
    this.expanded = expanded;
    this.selected = selected;
    this.rows = flatten(nodes, expanded);
    this.spacer.style.height = `${this.rows.length * this.opts.rowHeight}px`;
    this.first = -1;
    this.last = -1;
    this.render();
  }

  setSelected(path: string): void {
    this.selected = path;
    this.render(true);
  }

  /** Scroll a path into view, expanding its ancestors if necessary. */
  reveal(path: string): void {
    let i = this.rows.findIndex((r) => r.path === path);
    if (i < 0) {
      let p = path;
      while (p !== '') {
        const cut = p.lastIndexOf('.');
        p = cut === -1 ? '' : p.slice(0, cut);
        this.expanded[p] = 1;
      }
      this.rows = flatten(this.nodes, this.expanded);
      this.spacer.style.height = `${this.rows.length * this.opts.rowHeight}px`;
      i = this.rows.findIndex((r) => r.path === path);
      if (i < 0) return;
    }
    const top = i * this.opts.rowHeight;
    const h = this.viewport.clientHeight;
    if (top < this.viewport.scrollTop || top + this.opts.rowHeight > this.viewport.scrollTop + h) {
      this.viewport.scrollTop = Math.max(0, top - h / 2);
    }
    this.render(true);
  }

  /** Cheap refresh of the numbers on already-mounted rows. */
  refresh(): void {
    this.render(true);
  }

  get rowCount(): number {
    return this.rows.length;
  }

  private onScroll = (): void => {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.render();
    });
  };

  private onClick = (ev: MouseEvent): void => {
    const el = (ev.target as HTMLElement).closest('[data-path]') as HTMLElement | null;
    if (!el) return;
    const path = el.dataset.path!;
    if ((ev.target as HTMLElement).closest('.tree-twisty')) this.opts.onToggle(path);
    else this.opts.onSelect(path);
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    const i = this.rows.findIndex((r) => r.path === this.selected);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const next = Math.min(this.rows.length - 1, Math.max(0, i + (ev.key === 'ArrowDown' ? 1 : -1)));
      if (this.rows[next]) {
        this.opts.onSelect(this.rows[next].path);
        this.reveal(this.rows[next].path);
      }
    } else if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      ev.preventDefault();
      const row = this.rows[i];
      if (!row) return;
      const wantOpen = ev.key === 'ArrowRight';
      if (row.hasChildren && row.expanded !== wantOpen) this.opts.onToggle(row.path);
      else if (!wantOpen && row.path !== '') {
        const cut = row.path.lastIndexOf('.');
        const parent = cut === -1 ? '' : row.path.slice(0, cut);
        this.opts.onSelect(parent);
        this.reveal(parent);
      }
    } else if (ev.key === 'Home' || ev.key === 'End') {
      ev.preventDefault();
      const target = ev.key === 'Home' ? 0 : this.rows.length - 1;
      if (this.rows[target]) {
        this.opts.onSelect(this.rows[target].path);
        this.reveal(this.rows[target].path);
      }
    }
  };

  /**
   * Mount exactly the rows in view (plus overscan) and reuse the elements when
   * the window merely shifts — the pool is only regrown when the window gets
   * bigger, so scrolling costs text updates, not node churn.
   */
  private render(force = false): void {
    const { rowHeight, overscan } = this.opts;
    const scrollTop = this.viewport.scrollTop;
    const height = this.viewport.clientHeight || 400;
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const last = Math.min(this.rows.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
    if (!force && first === this.first && last === this.last) return;
    this.first = first;
    this.last = last;

    const need = Math.max(0, last - first);
    while (this.pool.length < need) {
      const el = makeRowElement();
      this.pool.push(el);
      this.layer.appendChild(el);
    }
    for (let i = need; i < this.pool.length; i++) this.pool[i].style.display = 'none';

    for (let i = 0; i < need; i++) {
      const row = this.rows[first + i];
      const node = this.nodes[row.path];
      const el = this.pool[i];
      if (!node) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.style.transform = `translateY(${(first + i) * rowHeight}px)`;
      paintRow(el, row, node, this.opts, row.path === this.selected);
    }
    this.layer.style.height = `${this.rows.length * rowHeight}px`;
  }
}

function makeRowElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tree-row';
  el.setAttribute('role', 'treeitem');
  el.innerHTML =
    '<button class="tree-twisty" tabindex="-1" aria-hidden="true"></button>' +
    '<span class="tree-dot"></span>' +
    '<span class="tree-name"></span>' +
    '<span class="tree-badge"></span>' +
    '<span class="tree-detail"></span>';
  return el;
}

function paintRow(
  el: HTMLElement,
  row: TreeRow,
  node: NodeData,
  opts: TreeViewOptions,
  selected: boolean,
): void {
  el.dataset.path = row.path;
  el.classList.toggle('is-selected', selected);
  el.setAttribute('aria-selected', selected ? 'true' : 'false');
  el.setAttribute('aria-level', String(row.depth + 1));
  el.style.paddingLeft = `${8 + row.depth * 13}px`;
  const accent = readableAccent(node.hue);

  const twisty = el.children[0] as HTMLElement;
  const dot = el.children[1] as HTMLElement;
  const name = el.children[2] as HTMLElement;
  const badge = el.children[3] as HTMLElement;
  const detail = el.children[4] as HTMLElement;

  if (row.hasChildren) {
    twisty.style.visibility = 'visible';
    twisty.textContent = row.expanded ? '▾' : '▸';
    twisty.setAttribute('aria-label', row.expanded ? 'Collapse branch' : 'Expand branch');
    el.setAttribute('aria-expanded', row.expanded ? 'true' : 'false');
  } else {
    twisty.style.visibility = 'hidden';
    twisty.textContent = '';
    el.removeAttribute('aria-expanded');
  }

  dot.style.background = accent;
  dot.style.boxShadow = `0 0 0 3px ${veil(node.hue, 0.16)}`;
  if (name.textContent !== node.name) name.textContent = node.name;
  name.style.color = selected ? accent : '';

  const b = opts.badge(node);
  if (badge.textContent !== b) badge.textContent = b;
  badge.style.display = b ? '' : 'none';
  badge.style.color = accent;
  badge.style.borderColor = veil(node.hue, 0.4);

  const d = opts.detail(node);
  if (detail.textContent !== d) detail.textContent = d;
}

/**
 * Depth-first flatten, skipping the subtrees of collapsed nodes. This is the
 * reason the view scales: a run with 10,000 nodes but only the root expanded
 * walks four nodes, not ten thousand.
 */
export function flatten(
  nodes: Record<string, NodeData>,
  expanded: Record<string, 1>,
): TreeRow[] {
  const out: TreeRow[] = [];
  const root = nodes[''];
  if (!root) return out;

  const walk = (path: string, depth: number): void => {
    const node = nodes[path];
    if (!node) return;
    let hasChildren = false;
    for (const g of node.gens) {
      if (g.door !== null && nodes[g.door]) {
        hasChildren = true;
        break;
      }
    }
    const isOpen = hasChildren && expanded[path] === 1;
    out.push({ path, depth, hasChildren, expanded: isOpen });
    if (!isOpen) return;
    for (const g of node.gens) {
      if (g.door !== null && nodes[g.door]) walk(g.door, depth + 1);
    }
  };

  walk('', 0);
  return out;
}
