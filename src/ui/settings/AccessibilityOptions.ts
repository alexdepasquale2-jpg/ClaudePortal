/**
 * Accessibility.
 *
 * Two of these are settings and one is a design constraint wearing a setting's clothes:
 *
 *  - colour-blind-safe faction colours: real, and load-bearing, because faction colour is how the
 *    player reads ownership on both the map and the ground. A player who cannot distinguish holder
 *    from contester cannot read the Consequence pillar at all.
 *  - reduced motion: camera shake and influence-bleed animation.
 *  - one-handed mobile play: NOT solvable here. Top-down works one-handed because auto-fire means
 *    the player never aims; the other two views do not, and no setting fixes that. It is listed in
 *    docs/GAPS.md as an open design question rather than pretended away with a toggle.
 */
export interface AccessibilitySettings {
  /** Alternative faction palette with distinguishable luminance as well as hue. */
  readonly colourBlindSafePalette: boolean;
  readonly reduceMotion: boolean;
  readonly reduceScreenShake: boolean;
  /** Larger touch targets and a wider virtual stick deadzone. */
  readonly largeTouchTargets: boolean;
  /** Show the loudness value numerically as well as on the bar. */
  readonly numericLoudness: boolean;
  /** Hold-to-confirm duration for destructive actions such as abandoning a run. */
  readonly confirmHoldSeconds: number;
}

export class AccessibilityOptions {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.root = document.createElement('div');
    this.root.className = 'settings-accessibility';
    container.appendChild(this.root);
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
  }

  render(_settings: AccessibilitySettings): void {
    // TODO: implement per DESIGN.md
    void this.root;
    throw new Error('AccessibilityOptions.render not implemented');
  }
}
