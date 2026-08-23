import { newCampaign } from './campaign';
import type { Campaign } from './types';

export const SAVE_KEY = 'skyneet.save.v1';

export function persist(c: Campaign): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(c));
  } catch {
    /* quota */
  }
}

export function load(): Campaign | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Campaign;
    if (!c || typeof c.seed !== 'number' || !c.sites) return null;
    return c;
  } catch {
    return null;
  }
}

export function reset(): Campaign {
  localStorage.removeItem(SAVE_KEY);
  return newCampaign();
}

export function boot(): Campaign {
  return load() ?? newCampaign();
}
