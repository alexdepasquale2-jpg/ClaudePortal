export type Signal<T> = { get(): T; set(v: T): void; sub(fn: (v: T) => void): () => void };

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const subs = new Set<(v: T) => void>();
  return {
    get: () => value,
    set(v) { if (v === value) return; value = v; for (const s of subs) s(v); },
    sub(fn) { subs.add(fn); fn(value); return () => subs.delete(fn); },
  };
}

/** Tiny DOM helper: el('div.class#id', {attrs}, children...). */
export function el(spec: string, attrs: Record<string, unknown> = {}, ...kids: (Node | string | null)[]): HTMLElement {
  const tag = spec.match(/^[a-z0-9]+/i)?.[0] ?? 'div';
  const e = document.createElement(tag);
  const id = spec.match(/#([\w-]+)/)?.[1];
  const classes = [...spec.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
  if (id) e.id = id;
  if (classes.length) e.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
    else if (v !== null && v !== undefined) e.setAttribute(k, String(v));
  }
  for (const k of kids) if (k !== null) e.append(k);
  return e;
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
export const show = (e: HTMLElement, on: boolean) => e.classList.toggle('hidden', !on);
