import type { GameSettings } from '@core/data/settings/GameSettings';
import { BaseMenuController } from '../MenuController';

/**
 * Player settings.
 *
 * One rule from the design shows up here as a non-option: autosave on run resolution cannot be
 * turned off. The campaign graph IS the game (ADR-0001), and a player who disabled autosaving would
 * be able to undo consequences — which would remove the pillar the whole architecture is bent
 * around. The type makes it a literal `true` so it cannot even be offered.
 *
 * Export and import of the campaign live here too. Local-only persistence (ADR-0005) means the
 * player's save is only ever on their device, so giving them a file is not a nicety.
 */
export class SettingsController extends BaseMenuController {
  readonly name = 'Settings';

  constructor(private settings: GameSettings) {
    super();
  }

  get current(): GameSettings {
    return this.settings;
  }

  refresh(): void {
    // TODO: implement per DESIGN.md — audio, look sensitivity, build mode hold vs toggle, motion
    // and touch-target accessibility, campaign export/import. Autosave is displayed as always-on
    // rather than as a disabled control the player will try to click.
    void this.settings;
    throw new Error('SettingsController.refresh not implemented');
  }

  apply(_changes: Partial<GameSettings>): void {
    // TODO: implement per DESIGN.md — merge, persist, and notify listeners.
    throw new Error('SettingsController.apply not implemented');
  }
}
