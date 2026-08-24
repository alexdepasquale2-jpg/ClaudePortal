import type { SavedRunRecord } from '@campaign/CampaignSave';
import { BaseMenuController } from '../MenuController';

/**
 * Read-only history, and blueprint loading. Nothing else.
 *
 * DESIGN.md: "Forts Menu (read-only history + blueprint load only)."
 *
 * This class is the reason the whole layer boundary exists. ADR-0002 says forts die with the run,
 * and the temptation this menu creates — "show me my fort, let me keep it" — is exactly what would
 * erode that. So the enforcement is structural rather than a note in a review: `ui` cannot import
 * `gameplay`, which means this file CANNOT reference FortRuntime. Not "should not". Cannot.
 * `npm run lint` fails on the attempt.
 *
 * What it can show is what forts left behind: which runs built how much, what it cost, how loud it
 * got, and whether the site was held. Consequences, not structures.
 */
export class FortsMenuController extends BaseMenuController {
  readonly name = 'Forts';

  constructor(private readonly history: readonly SavedRunRecord[]) {
    super();
  }

  refresh(): void {
    // TODO: implement per DESIGN.md — per-run records: site, end type, peak loudness, whether a
    // Sancient came, whether the site flipped. Plus the blueprint list, for loading into the NEXT
    // run. Never a fort layout: there is nothing stored to draw, by design.
    void this.history;
    throw new Error('FortsMenuController.refresh not implemented');
  }

  /** Choose a blueprint to carry into the next operation. */
  onBlueprintSelected(_handler: (blueprintId: string) => void): void {
    // TODO: implement per DESIGN.md
    throw new Error('FortsMenuController.onBlueprintSelected not implemented');
  }
}
