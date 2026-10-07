/**
 * One-shot entrance animations. CSS animations restart whenever a hidden view
 * is shown again; Web Animations run once per element. Skipped entirely when
 * the user prefers reduced motion.
 */

export interface Entrance {
  keyframes: Keyframe[];
  duration: number;
  delay?: number;
}

/** Svelte action: `use:entrance={{ keyframes, duration }}`. */
export function entrance(node: Element, { keyframes, duration, delay = 0 }: Entrance): void {
  if (typeof node.animate !== 'function') return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  node.animate(keyframes, {
    duration,
    delay,
    easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
    fill: 'backwards',
  });
}
