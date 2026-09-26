import { newHeaven } from './heaven';
import type { Heaven } from './types';

export const SAVE_KEY = 'heaven.save.v1';

/**
 * Everything saved is a number, a part, or a room. There is no field a story's
 * words could be put in, and nothing is sent anywhere.
 */
export function persist(h: Heaven): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(h));
  } catch {
    /* quota or private mode: it simply will not remember */
  }
}

export function load(): Heaven | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const h = JSON.parse(raw) as Heaven;
    if (!h || h.v !== 1 || typeof h.seed !== 'number' || !h.house || !h.city || !h.sky) return null;
    return h;
  } catch {
    return null;
  }
}

export function forget(): Heaven {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing to forget */
  }
  return newHeaven();
}

export function boot(): Heaven {
  return load() ?? newHeaven();
}
