import { PARTS } from './parts';
import type { Gait, Heaven } from './types';

/** A limb counts as a leg when it points downward enough to bear weight. */
export function isLeg(angle: number): boolean {
  return Math.sin(angle) > 0.25;
}

/**
 * How it walks is the verdict on what you gave it. Vain parts limp no matter
 * how well the legs are placed. True parts only unbalance it a little, and
 * only when they are all piled on one side.
 */
export function gait(h: Pick<Heaven, 'limbs' | 'parts'>): Gait {
  const legs = h.limbs.filter((l) => isLeg(l.angle));
  let reach = 0;
  let lean = 0;
  for (const l of legs) {
    reach += l.length;
    lean += Math.cos(l.angle) * l.length;
  }
  const legImbalance = legs.length === 0 ? 0 : Math.min(1, Math.abs(lean) / Math.max(0.001, reach));

  let vain = 0;
  let load = 0;
  for (const p of h.parts) {
    if (PARTS[p.kind].truth === 'vain') vain++;
    load += Math.cos(p.angle);
  }
  const loadImbalance = h.parts.length === 0 ? 0 : Math.abs(load) / (h.parts.length + 2);

  const limp = Math.min(1, vain * 0.34 + legImbalance * 0.45 + loadImbalance * 0.25);
  const grace = legs.length === 0 ? 0.25 * (1 - limp) : Math.max(0, 1 - limp) * Math.min(1, 0.55 + legs.length * 0.18);
  const trueParts = h.parts.length - vain;

  let why: string;
  let rests = false;
  if (vain > 0) {
    const names = h.parts.filter((p) => PARTS[p.kind].truth === 'vain').map((p) => PARTS[p.kind].name.toLowerCase());
    why = `It limps under the ${names.join(' and the ')}.`;
  } else if (legs.length < 2) {
    why = legs.length === 0 ? 'It has nothing to stand on. Pull a limb out of its lower side.' : 'One leg. It hops. Give it another.';
  } else if (legImbalance > 0.55) {
    why = 'Its legs lean one way. It walks, but it cannot settle.';
  } else if (trueParts === 0) {
    why = 'It walks well and has nothing to rest on yet.';
  } else {
    rests = true;
    why = 'It walks, and then it rests.';
  }
  return { grace, limp, rests, why };
}

export type Meeting = 'stays' | 'flinches' | 'wanders';

/**
 * How it meets a story it has just received: it walks through it. Vain parts
 * make it flinch; a body that can rest stays in the middle of it; a body with
 * nothing to rest on yet only wanders across.
 */
export function meets(h: Pick<Heaven, 'limbs' | 'parts'>): { how: Meeting; why: string } {
  const g = gait(h);
  if (h.parts.some((p) => PARTS[p.kind].truth === 'vain')) return { how: 'flinches', why: 'It flinched at your story. It is carrying something vain.' };
  if (g.rests) return { how: 'stays', why: 'It walked into your story and stayed there.' };
  return { how: 'wanders', why: 'It wandered across your story. It has nowhere in it to rest yet.' };
}
