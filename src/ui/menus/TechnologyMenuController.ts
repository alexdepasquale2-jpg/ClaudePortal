import type { TechNode } from '@core/data/tech/TechTree';
import type { MaterialCounts } from '@core/types/Vocabulary';
import { BaseMenuController } from '../MenuController';

/**
 * The one permanent tech tree.
 *
 * Ordering is the design: head-starts, then curves, then formations, then perks, and FINALLY camera
 * presets. The camera preset nodes sitting at the deep end of the tree is how "views reach parity
 * late via meta unlocks" is actually delivered — the third and first person views are genuinely
 * worse until the player has spent a campaign getting there.
 *
 * When a node is locked, show every reason at once: missing tech, missing feats, and material
 * shortfall together. Revealing one blocker at a time turns progression into a guessing game.
 */
export class TechnologyMenuController extends BaseMenuController {
  readonly name = 'Technology';

  constructor(
    private readonly nodes: readonly TechNode[],
    private readonly unlocked: ReadonlySet<string>,
    private readonly earnedFeats: ReadonlySet<string>,
    private readonly stockpile: MaterialCounts,
  ) {
    super();
  }

  refresh(): void {
    // TODO: implement per DESIGN.md — lay out by tier and category, run UnlockGate for each node,
    // and render every refusal reason together rather than the first one found.
    void this.nodes;
    void this.unlocked;
    void this.earnedFeats;
    void this.stockpile;
    throw new Error('TechnologyMenuController.refresh not implemented');
  }
}
