import type { Faction } from '@core/types/Vocabulary';
import type { Ownership } from './Ownership';
import type { RunResult } from './RunResult';

/**
 * Where a run becomes a consequence.
 *
 * DESIGN.md: "When you die or extract, ownership of the site and its production can flip." CAN, not
 * does — the flip is conditional, and the conditions are what make holding ground meaningful rather
 * than automatic.
 *
 * This is the single most important unimplemented function in the codebase. The tie-break rule in
 * PILLARS.md says Consequence wins when pillars conflict, and this is Consequence's entire
 * mechanism. The exact rules are NOT settled — see docs/GAPS.md ("Ownership flip rules"). They are
 * left unimplemented rather than given a placeholder, because a placeholder here would quietly
 * become the design.
 */
export interface FlipOutcome {
  readonly before: Ownership;
  readonly after: Ownership;
  readonly flipped: boolean;
  /** Why it went the way it did — shown to the player on the post-run screen. */
  readonly reason: FlipReason;
}

export type FlipReason =
  /** Extracted from a site nobody else held, having lit it. */
  | 'claimed'
  /** Extracted from a site while holding it; grip increased. */
  | 'held'
  /** Died at a site you held; whoever contested it takes over. */
  | 'lost-on-death'
  /** Died at a site you did not hold; nothing changed hands, but the site remembers. */
  | 'contested-only'
  /** Withdrew with a node still lit; the site is left producing for someone else. */
  | 'abandoned-lit'
  /** Withdrew cleanly; no change. */
  | 'no-change';

export class OwnershipFlip {
  /**
   * Apply a resolved run to a site's ownership.
   *
   * Must be a pure function of (ownership, result): the same run applied twice produces the same
   * outcome, and no other state is consulted. That is what lets a campaign save be replayed and a
   * flip be explained to the player after the fact.
   */
  static apply(_ownership: Ownership, _result: RunResult, _tick: number): FlipOutcome {
    // TODO: implement per DESIGN.md and resolve docs/GAPS.md first. The open questions:
    //   - who receives a site when the player dies: nearest influencing faction, last aggressor,
    //     or whoever already contested it?
    //   - does an unlit site flip at all, or is lighting it the act that makes it claimable?
    //   - how much does grip absorb before a flip happens, and does dying always reset it?
    //   - what does a betrayed Nobot group's claim outrank?
    throw new Error('OwnershipFlip.apply not implemented — see docs/GAPS.md');
  }

  /** Which faction takes a site the player just lost. Extracted so it can be tested in isolation. */
  static successorOnLoss(_ownership: Ownership, _result: RunResult): Faction {
    // TODO: implement per DESIGN.md
    throw new Error('OwnershipFlip.successorOnLoss not implemented');
  }
}
