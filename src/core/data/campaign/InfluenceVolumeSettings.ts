import { z } from 'zod';
import { NonNegativeSchema, PositiveSchema, parseData } from '../schema';
import rawSettings from './influence-volume-settings.json';

/**
 * How far a lit or owned site projects influence, and what happens where influences overlap.
 *
 * DESIGN.md on the Warfront: "Purely emergent from overlapping territory influence of lit/owned
 * sites. No separate mode. Competence floors rise inside overlapping volumes."
 *
 * So there is no Warfront object anywhere in the codebase. There is only this settings file, the
 * per-site influence it produces, and WarfrontCalculator finding the overlaps. Everything the
 * player experiences as a front line comes out of these numbers.
 */
export const InfluenceVolumeSettingsSchema = z.object({
  /** Base radius, in region-map units, of a site's influence. */
  baseRadius: PositiveSchema,
  /** Extra radius per lit node at the site. Lighting up is territorial, not just loud. */
  radiusPerLitNode: NonNegativeSchema,
  /** Influence at the centre, 0..1. */
  peakStrength: z.number().min(0).max(1),
  /** How strength falls toward the edge. */
  falloff: z.enum(['linear', 'smoothstep', 'inverse-square']),
  /** Competence floor contributed at full strength by a single influence volume. */
  competenceFloorAtPeak: z.number().min(0).max(1),
  /**
   * How overlapping volumes combine. 'max' means a second faction's presence adds nothing;
   * 'sum-clamped' means a contested region is worse than either side alone — which is what makes a
   * front line somewhere you do not want to be. See docs/GAPS.md: not finally settled.
   */
  overlapCombination: z.enum(['max', 'sum-clamped', 'multiply-inverse']),
  /** Minimum combined strength before a region counts as contested at all. */
  contestThreshold: z.number().min(0).max(1),
  /** Multiplier on the floor where two or more DIFFERENT factions overlap. */
  contestedFloorMultiplier: z.number().min(1),
  /** Campaign ticks for influence to grow to full after a flip. Fronts move, but not instantly. */
  growthTicks: PositiveSchema,
});

export type InfluenceVolumeSettings = z.infer<typeof InfluenceVolumeSettingsSchema>;

let cache: InfluenceVolumeSettings | null = null;

export function loadInfluenceVolumeSettings(): InfluenceVolumeSettings {
  cache ??= parseData('influence-volume-settings.json', InfluenceVolumeSettingsSchema, rawSettings);
  return cache;
}
