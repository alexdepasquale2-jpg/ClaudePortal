import type { Scene } from '@core/bootstrap/SceneRouter';

/**
 * Title, campaign slots, and the way in.
 *
 * The one interesting decision here is that starting a NEW campaign is a destructive act with a
 * consequence the player cannot undo, so it is presented as such. An existing campaign is the
 * player's entire investment (ADR-0001), and offering "New Campaign" next to "Continue" with equal
 * weight is how that investment gets discarded by accident.
 */
export class MainMenuScene implements Scene {
  readonly name = 'MainMenu';

  constructor(private readonly overlay: HTMLElement) {}

  load(): void {
    // TODO: implement per DESIGN.md — list campaign slots from CampaignStore, offer continue,
    // new campaign (with confirmation), and import from a save file.
    void this.overlay;
    throw new Error('MainMenuScene.load not implemented');
  }

  unload(): void {
    this.overlay.replaceChildren();
  }
}
