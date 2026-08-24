import { DEFAULT_VIEW_MODE, type ViewMode } from '../types/Vocabulary';

/**
 * What the device in front of us can do.
 *
 * Mobile is a target, not a downscale (ADR-0005). This is the one place where that becomes a real
 * decision rather than a rendering detail: it picks the default view and the quality tier, and it
 * decides whether touch or keyboard/mouse is the primary input.
 *
 * Probed once at bootstrap. Everything downstream reads the result rather than sniffing again.
 */

export type QualityTierName = 'mobile' | 'balanced' | 'high';

export interface Capabilities {
  readonly hasTouch: boolean;
  readonly hasPointer: boolean;
  readonly hasKeyboard: boolean;
  readonly webglVersion: 1 | 2 | null;
  readonly devicePixelRatio: number;
  readonly hardwareConcurrency: number;
  readonly prefersReducedMotion: boolean;
  readonly suggestedQuality: QualityTierName;
  readonly suggestedView: ViewMode;
}

export function probeCapabilities(): Capabilities {
  const hasTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  const hasPointer =
    typeof matchMedia === 'function' ? matchMedia('(pointer: fine)').matches : !hasTouch;
  const prefersReducedMotion =
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  const hardwareConcurrency =
    typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4;
  const devicePixelRatio = typeof window !== 'undefined' ? (window.devicePixelRatio ?? 1) : 1;

  const webglVersion = detectWebGL();

  // A touch device with no fine pointer is a phone: assume a tighter budget until proven otherwise.
  const suggestedQuality: QualityTierName =
    hasTouch && !hasPointer ? 'mobile' : hardwareConcurrency >= 8 ? 'high' : 'balanced';

  return {
    hasTouch,
    hasPointer,
    hasKeyboard: hasPointer || !hasTouch,
    webglVersion,
    devicePixelRatio,
    hardwareConcurrency,
    prefersReducedMotion,
    suggestedQuality,
    // Top-down is the default everywhere; on touch it is also the only view that is comfortable
    // one-handed, which is why the other two stay behind meta unlocks (see docs/GAPS.md).
    suggestedView: DEFAULT_VIEW_MODE,
  };
}

function detectWebGL(): 1 | 2 | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    if (canvas.getContext('webgl2')) return 2;
    if (canvas.getContext('webgl')) return 1;
    return null;
  } catch {
    return null;
  }
}
