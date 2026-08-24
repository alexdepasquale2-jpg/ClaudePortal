import type { Faction, MaterialCounts, SiteId } from '@core/types/Vocabulary';
import type { FlipOutcome } from '@campaign/OwnershipFlip';

/**
 * Who gets the production when a site changes hands.
 *
 * DESIGN.md: "When you die or extract, ownership of the site AND ITS PRODUCTION can flip."
 *
 * This is the sharpest edge of the Consequence pillar. Losing a site is not only losing a position
 * on the map — the refineries you built, the nodes you lit, and the output they generate all start
 * working for whoever took it from you. The battlefield changed, and it changed in their favour
 * using your work.
 *
 * Note what does NOT transfer: the fort. It never existed at campaign scale (ADR-0002). What
 * transfers is the lit nodes and the production they enable.
 */
export interface InheritanceOutcome {
  readonly siteId: SiteId;
  readonly previousOwner: Faction;
  readonly newOwner: Faction;
  /** Production the new owner now receives per campaign tick. */
  readonly inheritedProduction: MaterialCounts;
  /** Material sitting in the site's output queue that changes hands with it. */
  readonly inheritedStockpile: MaterialCounts;
  /** Nodes still lit, now working for the new owner. */
  readonly inheritedLitNodes: readonly string[];
}

export class ProductionInheritance {
  /**
   * Apply a flip to a site's production.
   *
   * Pure function of the flip outcome and the site's state — same inputs, same result — so the
   * post-run screen can explain exactly what was handed over and why.
   */
  static apply(
    _flip: FlipOutcome,
    _production: MaterialCounts,
    _stockpile: MaterialCounts,
    _litNodes: readonly string[],
  ): InheritanceOutcome {
    // TODO: implement per DESIGN.md
    //  - a site that did not flip inherits nothing; production stays where it was
    //  - lit nodes transfer lit. Whoever holds the site holds the signal.
    //  - queued output transfers with the site rather than evaporating
    //  - does the new owner inherit at full rate immediately, or does production ramp?
    //    Unresolved; see docs/GAPS.md.
    throw new Error('ProductionInheritance.apply not implemented');
  }
}
