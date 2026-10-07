/** What every XUI node in a pane can reach: the pane and its action runner. */

import { getContext, setContext } from 'svelte';
import type { Action } from './api';
import type { Pane } from './shell.svelte';

export interface XuiContext {
  readonly pane: Pane;
  /** Runs a button's action: an intent to this Organism, or a Warden-checked tool call. */
  run(action: Action): Promise<void>;
}

const KEY = Symbol('xui');

export function setXui(ctx: XuiContext): void {
  setContext(KEY, ctx);
}

export function getXui(): XuiContext {
  return getContext<XuiContext>(KEY);
}
