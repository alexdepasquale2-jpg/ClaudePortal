import type {
  Faction,
  FlavorTag,
  MaterialCounts,
  NobotGroupId,
  NodeId,
  RunEndType,
  SiteId,
} from '@core/types/Vocabulary';

/**
 * Everything one run hands to the campaign.
 *
 * This is the ONLY channel from a live run to the permanent record. ARCHITECTURE.md: scenes are the
 * only place a run and the campaign meet, and only by passing one of these. That narrowness is
 * deliberate — it makes "what can a run change?" answerable by reading a single interface.
 *
 * Note what is not here: no fort, no geometry, no card selections, no live enemy state. A run's
 * consequences are what survive it, not its contents (ADR-0002).
 */
export interface RunResult {
  readonly runId: string;
  readonly siteId: SiteId;
  readonly endType: RunEndType;
  readonly durationMs: number;
  /** Seed the run was generated from — enough to reproduce it exactly. */
  readonly seed: number;

  /** Materials that actually reached the surface. Died means this is empty, however good the haul. */
  readonly extracted: MaterialCounts;
  /** Materials consumed by building during the run. Spent whether or not you got out. */
  readonly consumed: MaterialCounts;

  /** Nodes still lit when the run ended. These keep producing for whoever holds the site. */
  readonly litNodes: readonly NodeId[];
  readonly chromedNodes: readonly NodeId[];

  /** Who the player contested the site against, if anyone. Drives the flip. */
  readonly contestedBy: readonly Faction[];
  /** Peak loudness reached. Feeds the site's memory of how noisy this place has become. */
  readonly peakLoudness: number;
  /** Whether a Sancient arrived, and whether it left anything permanent behind. */
  readonly sancientArrived: boolean;
  readonly permanentJacksLeft: number;

  /** Nobot groups involved — ADR-0004, radicalisation rises on RESOLVED operations. */
  readonly involvedNobotGroups: readonly NobotGroupId[];

  /** The single flavor tag active at the end. Exactly one, or none. */
  readonly flavorTag: FlavorTag | null;

  /** Whether a usable Pyron Chrome mass was discovered. Campaign-level event. */
  readonly pyronChromeDiscovered: boolean;

  /** Metrics for feat evaluation, keyed by metric id. */
  readonly metrics: Readonly<Record<string, number>>;
}
