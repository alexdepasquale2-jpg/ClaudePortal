import type { GoliathCatalogEntry } from '@core/data/factions/GoliathCatalog';
import type { Vec3 } from '@core/types/Vocabulary';

/**
 * One machine that inherited the surface and came down here anyway.
 *
 * Its catalog is fixed for its whole life. Its competence is not stored on it at all — it is
 * recomputed from the local floor every tick by LethalityCompetence (ADR-0003). Anything that
 * cached competence here would let it drift out of step with the floor, and the reversal would stop
 * being instantaneous.
 *
 * `jackedBy` is the visible cause of that reversal, so the HUD can point at it.
 */
export interface Goliath {
  readonly id: string;
  readonly catalog: GoliathCatalogEntry;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly yaw: number;
  readonly health: number;
  /** Sancient id currently jacking this one, or null. */
  readonly jackedBy: string | null;
  /** Whether the jack that raised this one's floor was permanent. */
  readonly permanentlyRaised: boolean;
}
