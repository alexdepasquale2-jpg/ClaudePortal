/**
 * modal.ts — one dialog shell for every overlay in the game.
 *
 * Focus is trapped while open and restored on close, Escape always dismisses,
 * and the shell is the only thing that touches `aria-hidden` on the app root —
 * so keyboard and screen-reader behaviour is identical everywhere rather than
 * re-implemented per screen.
 */

export interface ModalHandle {
  el: HTMLElement;
  body: HTMLElement;
  close(): void;
}

let openCount = 0;

export function openModal(
  title: string,
  build: (body: HTMLElement, close: () => void) => void,
  opts: { wide?: boolean; onClose?(): void; dismissable?: boolean } = {},
): ModalHandle {
  const previous = document.activeElement as HTMLElement | null;
  const root = document.getElementById('app');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-modal', 'true');
  scrim.setAttribute('aria-label', title);

  const el = document.createElement('div');
  el.className = `modal${opts.wide ? ' modal-wide' : ''}`;
  el.innerHTML =
    '<header class="modal-head"><h2></h2><button class="modal-close" aria-label="Close">✕</button></header>' +
    '<div class="modal-body"></div>';
  (el.querySelector('h2') as HTMLElement).textContent = title;
  scrim.appendChild(el);
  document.body.appendChild(scrim);

  openCount++;
  if (root && openCount === 1) root.setAttribute('aria-hidden', 'true');

  const body = el.querySelector('.modal-body') as HTMLElement;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    openCount = Math.max(0, openCount - 1);
    if (root && openCount === 0) root.removeAttribute('aria-hidden');
    document.removeEventListener('keydown', onKey, true);
    scrim.remove();
    opts.onClose?.();
    previous?.focus?.();
  };

  const dismissable = opts.dismissable !== false;
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && dismissable) {
      ev.stopPropagation();
      close();
      return;
    }
    if (ev.key !== 'Tab') return;
    const focusables = el.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKey, true);

  (el.querySelector('.modal-close') as HTMLElement).addEventListener('click', close);
  if (!dismissable) (el.querySelector('.modal-close') as HTMLElement).style.display = 'none';
  scrim.addEventListener('click', (ev) => {
    if (ev.target === scrim && dismissable) close();
  });

  build(body, close);
  const firstFocus = el.querySelector<HTMLElement>(
    '.modal-body button, .modal-body input, .modal-body select, .modal-body textarea',
  );
  (firstFocus ?? (el.querySelector('.modal-close') as HTMLElement)).focus();

  return { el, body, close };
}

/** Small helper for building DOM without a framework. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** A yes/no the player has to mean. Used for anything destructive. */
export function confirmModal(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
  requireTyping?: string,
): void {
  openModal(title, (body, close) => {
    body.appendChild(h('p', { class: 'muted', text: message }));
    let input: HTMLInputElement | null = null;
    if (requireTyping) {
      body.appendChild(
        h('p', { class: 'muted small', text: `Type ${requireTyping} to confirm.` }),
      );
      input = h('input', { type: 'text', class: 'text-input', 'aria-label': 'Confirmation' });
      body.appendChild(input);
    }
    const go = h('button', { class: 'btn btn-danger', text: confirmLabel });
    go.addEventListener('click', () => {
      if (requireTyping && input?.value.trim().toUpperCase() !== requireTyping.toUpperCase()) {
        input?.classList.add('is-bad');
        return;
      }
      close();
      onConfirm();
    });
    const cancel = h('button', { class: 'btn', text: 'Cancel' });
    cancel.addEventListener('click', close);
    body.appendChild(h('div', { class: 'row gap' }, cancel, go));
  });
}
