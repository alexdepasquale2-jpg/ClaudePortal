import type { Scene } from '@core/bootstrap/SceneRouter';

/**
 * Settings, as a top-level destination.
 *
 * Separate from the in-run pause overlay on purpose: settings reached from the main menu are a
 * calm activity, while settings reached mid-run must not stop the world for long. The two share
 * SettingsController and differ only in how they are mounted.
 */
export class SettingsScene implements Scene {
  readonly name = 'Settings';

  constructor(private readonly overlay: HTMLElement) {}

  load(): void {
    // TODO: implement per DESIGN.md — mount SettingsController, KeyRebindUI and
    // AccessibilityOptions, plus campaign export/import.
    void this.overlay;
    throw new Error('SettingsScene.load not implemented');
  }

  unload(): void {
    this.overlay.replaceChildren();
  }
}
