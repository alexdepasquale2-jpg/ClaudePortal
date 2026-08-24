import type { ArchipelagoGraph } from '@campaign/ArchipelagoGraph';
import type { InfluenceVolume } from '@campaign/TerritoryInfluence';
import { BaseMenuController } from '../MenuController';

/**
 * The top-level map, and the game's actual scoreboard.
 *
 * ADR-0001: the permanent record is the SHAPE of the campaign graph the player has created. This
 * menu is where the player sees that shape — which is why it is the answer to "did anything I did
 * matter?" and why the definition of done for the vertical slice is stated in terms of this screen
 * (SCOPE-LEDGER.md): close the tab, reopen it, and a site you lost is still lost.
 *
 * Influence bleed is drawn here rather than computed here. WarfrontCalculator produces the overlaps;
 * this renders them. There is no Warfront mode because there is no Warfront object — just this
 * drawing what the graph implies.
 *
 * Renders the graph. Never loads it as a scene.
 */
export class WorldMenuController extends BaseMenuController {
  readonly name = 'World';

  constructor(
    private readonly graph: ArchipelagoGraph,
    private readonly influence: readonly InfluenceVolume[],
  ) {
    super();
  }

  refresh(): void {
    // TODO: implement per DESIGN.md — draw regions and sites with their current holder, mark
    // contested sites, overlay influence bleed from this.influence, and offer descent into a site.
    // Ownership colour must match Materials.FACTION_COLORS so a site reads the same here as in the
    // hole.
    void this.graph;
    void this.influence;
    throw new Error('WorldMenuController.refresh not implemented');
  }

  /** Hand a chosen site to the scene router. The menu does not start the run itself. */
  onSiteSelected(_handler: (siteId: string) => void): void {
    // TODO: implement per DESIGN.md
    throw new Error('WorldMenuController.onSiteSelected not implemented');
  }
}
