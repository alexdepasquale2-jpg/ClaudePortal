import type { FactionStanding, NobotGroupStanding } from '@campaign/FactionStanding';
import { BaseMenuController } from '../MenuController';

/**
 * Goliaths, Sancients and Nobots — with the radicalisation meters.
 *
 * The meters are not a nicety. ADR-0004 lists "requires a faction UI that makes an invisible
 * accumulating number legible before it fires" as a COST of the radicalisation design, and this
 * screen is how that cost gets paid. A betrayal the player did not see coming reads as arbitrary
 * rather than as consequence.
 *
 * So a group approaching its threshold must be obviously approaching it, here and in the HUD.
 */
export class FactionMenuController extends BaseMenuController {
  readonly name = 'Faction';

  constructor(
    private readonly standings: readonly FactionStanding[],
    private readonly nobotGroups: readonly NobotGroupStanding[],
  ) {
    super();
  }

  refresh(): void {
    // TODO: implement per DESIGN.md — per-faction standing, and for Nobots a per-GROUP
    // radicalisation meter showing distance to the betrayal threshold. Show the threshold itself,
    // not just the value: a bar with no marked line is not a warning.
    void this.standings;
    void this.nobotGroups;
    throw new Error('FactionMenuController.refresh not implemented');
  }
}
