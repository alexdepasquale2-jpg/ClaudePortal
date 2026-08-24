import type { Faction, SiteId } from '@core/types/Vocabulary';

/**
 * Who holds a site, and how firmly.
 *
 * The Consequence pillar in its smallest form. DESIGN.md: "When you die or extract, ownership of the
 * site and its production can flip."
 *
 * `contested` is separate from `holder` on purpose. A site can be held by one faction and contested
 * by another — that is what a front line is, and it is what makes the Warfront legible on the World
 * menu without any Warfront object existing.
 */
export interface Ownership {
  readonly siteId: SiteId;
  readonly holder: Faction;
  /** Factions actively pressing a claim. May include the holder's rivals and betrayed Nobots. */
  readonly contestedBy: readonly Faction[];
  /** How entrenched the holder is, 0..1. Low means the next run can take it. */
  readonly grip: number;
  /** Campaign tick at which the current holder took it. */
  readonly heldSinceTick: number;
  /** How many times this site has changed hands. The site's own history, in one number. */
  readonly flipCount: number;
}

export const unowned = (siteId: SiteId, tick = 0): Ownership => ({
  siteId,
  holder: 'Unowned',
  contestedBy: [],
  grip: 0,
  heldSinceTick: tick,
  flipCount: 0,
});

export const isContested = (ownership: Ownership): boolean => ownership.contestedBy.length > 0;

export const isHeldBy = (ownership: Ownership, faction: Faction): boolean =>
  ownership.holder === faction;
