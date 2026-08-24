import type { Vec3 } from '@core/types/Vocabulary';

/**
 * The way out.
 *
 * The extraction zone is the fixed point the Greed pillar is measured against. Every metre away
 * from it is a bet, and the site generator places the good material deliberately far from it
 * (BiomeDefinition.greedDistance).
 *
 * It is always visible or always findable — never hidden. A player who cannot find the exit is not
 * experiencing greed, they are experiencing a navigation problem.
 */
export interface ExtractionZone {
  readonly id: string;
  readonly position: Vec3;
  readonly radius: number;
  /** Seconds the player must remain inside before extraction completes. */
  readonly holdSeconds: number;
  /** False while something is contesting it. A contested exit is the run's last real decision. */
  readonly available: boolean;
}

export const distanceToExtraction = (position: Vec3, zone: ExtractionZone): number =>
  Math.hypot(
    position.x - zone.position.x,
    position.y - zone.position.y,
    position.z - zone.position.z,
  );

export const isInsideZone = (position: Vec3, zone: ExtractionZone): boolean =>
  distanceToExtraction(position, zone) <= zone.radius;
