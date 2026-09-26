import type { Attached, Fit, Heaven, PartKind } from './types';

export interface PartDef {
  kind: PartKind;
  name: string;
  truth: 'true' | 'vain';
  /** What it does, said plainly. */
  line: string;
}

export const PARTS: Record<PartKind, PartDef> = {
  table: { kind: 'table', name: 'Table', truth: 'true', line: 'Somewhere to set things down. It makes oil for the lamp, slowly.' },
  lamp: { kind: 'lamp', name: 'Lamp', truth: 'true', line: 'Carries the warmth while you are gone. Burns oil. That is the whole business.' },
  loaf: { kind: 'loaf', name: 'Loaf', truth: 'true', line: 'Bread on the table. Stories received make the house bigger.' },
  shore: { kind: 'shore', name: 'Shore', truth: 'true', line: 'Somewhere to walk to. The water brings oil in.' },
  door: { kind: 'door', name: 'Door', truth: 'true', line: 'A door that can close, and open. Without it, this is a factory.' },
  bed: { kind: 'bed', name: 'Bed', truth: 'true', line: 'Sleep by the lamp. Warmth lasts longer.' },
  crown: { kind: 'crown', name: 'Crown', truth: 'vain', line: 'Tall. Heavy on one side.' },
  coin: { kind: 'coin', name: 'Coin slot', truth: 'vain', line: 'Bills each story. A billed story is not received.' },
  mirror: { kind: 'mirror', name: 'Mirror', truth: 'vain', line: 'It looks at itself instead of at you. Warmth stops spreading.' },
  lock: { kind: 'lock', name: 'Lock', truth: 'vain', line: 'Makes the graph go up. Nobody can leave.' },
};

export const TRUE_PARTS: PartKind[] = ['table', 'lamp', 'loaf', 'shore', 'door', 'bed'];
export const VAIN_PARTS: PartKind[] = ['crown', 'coin', 'mirror', 'lock'];
export const ALL_PARTS: PartKind[] = [...TRUE_PARTS, ...VAIN_PARTS];

export function count(h: Heaven, kind: PartKind): number {
  let n = 0;
  for (const p of h.parts) if (p.kind === kind) n++;
  return n;
}

export function has(h: Heaven, kind: PartKind): boolean {
  return h.parts.some((p) => p.kind === kind);
}

export function slots(h: Heaven): number {
  return 3 + h.table;
}

/** How many of this part the body will take. Tables and lamps can repeat; the rest are single. */
function limit(kind: PartKind): number {
  if (kind === 'lamp') return 3;
  if (kind === 'table') return 2;
  return 1;
}

/**
 * Does this part belong right now? True parts click only when what they need
 * is already there. Vain parts always attach — that is the temptation — and
 * the creature walks with a limp.
 */
export function fit(h: Heaven, kind: PartKind): Fit {
  if (h.stage < 2) return { ok: false, how: 'no', why: 'It has no body yet. Hold the seed; tell it one thing.' };
  if (h.parts.length >= slots(h)) return { ok: false, how: 'no', why: 'Its hands are full. Expand the table, or take something off.' };
  if (count(h, kind) >= limit(kind)) return { ok: false, how: 'no', why: `It already has ${kind === 'lamp' ? 'enough lamps' : `a ${PARTS[kind].name.toLowerCase()}`}.` };
  const def = PARTS[kind];
  if (def.truth === 'vain') {
    if (kind === 'lock' && !has(h, 'door')) return { ok: false, how: 'no', why: 'There is no door to lock.' };
    return { ok: true, how: 'limp', why: def.line };
  }
  switch (kind) {
    case 'table':
      return { ok: true, how: 'click', why: def.line };
    case 'lamp':
      if (h.warmth < 1) return { ok: false, how: 'no', why: 'A lamp needs a flame. The seed has gone dark — hold it.' };
      return { ok: true, how: 'click', why: def.line };
    case 'loaf':
      if (!has(h, 'table')) return { ok: false, how: 'no', why: 'Bread needs a table first.' };
      return { ok: true, how: 'click', why: def.line };
    case 'shore':
      if (h.limbs.length < 2) return { ok: false, how: 'no', why: 'Nothing to walk there with. Stretch it two limbs.' };
      return { ok: true, how: 'click', why: def.line };
    case 'door': {
      const walls = count(h, 'table') + count(h, 'bed') + count(h, 'shore');
      if (walls < 1) return { ok: false, how: 'no', why: 'A door needs a house around it. Give it a table first.' };
      return { ok: true, how: 'click', why: def.line };
    }
    case 'bed':
      if (!has(h, 'lamp')) return { ok: false, how: 'no', why: 'It sleeps by a lamp. Give it one first.' };
      return { ok: true, how: 'click', why: def.line };
    default:
      return { ok: false, how: 'no', why: '' };
  }
}

export function attach(h: Heaven, kind: PartKind, angle: number): Fit {
  const f = fit(h, kind);
  if (!f.ok) return f;
  h.parts.push({ kind, angle: normAngle(angle) });
  if (kind === 'lock') h.factories += 1;
  return f;
}

/** Take a part off. Removing what another part stands on takes that part off too. */
export function detach(h: Heaven, index: number): Attached[] {
  const gone = h.parts.splice(index, 1);
  if (gone.length === 0) return gone;
  const kind = gone[0].kind;
  const orphaned = (k: PartKind): boolean => {
    if (k === 'loaf') return !has(h, 'table');
    if (k === 'bed') return !has(h, 'lamp');
    if (k === 'lock') return !has(h, 'door');
    return false;
  };
  if (kind === 'table' || kind === 'lamp' || kind === 'door') {
    for (let i = h.parts.length - 1; i >= 0; i--) {
      if (orphaned(h.parts[i].kind)) gone.push(...h.parts.splice(i, 1));
    }
  }
  return gone;
}

export function tableCost(h: Heaven): number {
  return Math.round(12 * Math.pow(1.8, h.table));
}

export function expandTable(h: Heaven): boolean {
  if (h.table >= 5) return false;
  const c = tableCost(h);
  if (h.oil < c) return false;
  h.oil -= c;
  h.table += 1;
  return true;
}

export function normAngle(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
