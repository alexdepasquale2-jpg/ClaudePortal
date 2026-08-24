import type { MaterialCounts, NodeId, NobotGroupId } from '@core/types/Vocabulary';

/**
 * What the campaign remembers about a site between runs.
 *
 * Read the list of fields and note what is absent: there is no fort here. No pieces, no modules, no
 * geometry, no damage. ADR-0002 — the fort you built this run dies with the run. What persists is
 * only the fort's consequences.
 *
 * `litNodes` persists because a node you left burning is exactly the kind of thing that changes the
 * battlefield for the next run — it keeps producing, it keeps making noise, and it keeps drawing
 * attention while you are not there.
 */
export interface SiteState {
  /** Biome id from the biome database; determines everything generation-side. */
  readonly biomeId: string;
  /** Nodes still lit when the last run ended. They keep working, for whoever holds the site. */
  readonly litNodes: readonly NodeId[];
  /** Nodes with Pyron Chrome installed. Reduced signature, extended safe hold. */
  readonly chromedNodes: readonly NodeId[];
  /** Materials held at this site, distinct from the global stockpile. */
  readonly stockpile: MaterialCounts;
  /** Production per campaign tick, inherited by whoever holds the site. */
  readonly production: MaterialCounts;
  /** Nobot groups living here, whether allied, neutral or betrayed. */
  readonly nobotGroups: readonly NobotGroupId[];
  /**
   * Competence floor that has become permanent here, 0..1. Raised by permanent Sancient jacks and
   * never lowered. A site you have fought over repeatedly is permanently harder — that is the
   * campaign graph remembering, and it is not reversible.
   */
  readonly permanentCompetenceFloor: number;
  /** Whether a usable Pyron Chrome mass is known to exist here. Campaign-level news. */
  readonly pyronChromeKnown: boolean;
  /** Campaign tick of the most recent resolved run at this site. */
  readonly lastVisitedTick: number;
  /** How many runs have resolved here. */
  readonly visitCount: number;
}
