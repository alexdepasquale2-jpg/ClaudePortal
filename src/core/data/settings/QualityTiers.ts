import { z } from 'zod';
import { IdSchema, PositiveSchema, parseData } from '../schema';
import rawTiers from './quality-tiers.json';

/**
 * Render budgets.
 *
 * ADR-0005: mobile is a distinct tier, not a downscale of the desktop one. A phone gets fewer
 * simultaneous Goliaths and a smaller particle budget rather than the same scene at half
 * resolution, because a Survivors spine dies on entity count long before it dies on pixels.
 *
 * `maxSimultaneousEnemies` is a gameplay-visible number, so changing a quality tier changes the
 * game. That is deliberate and it is why SiteGenerator reads the tier when placing spawns rather
 * than the renderer culling afterwards.
 */
export const QualityTierSchema = z.object({
  id: IdSchema,
  displayName: z.string().min(1),
  /** Cap on devicePixelRatio. */
  maxPixelRatio: PositiveSchema,
  shadows: z.enum(['off', 'hard', 'soft']),
  /** Hard cap on live Goliaths. Gameplay-visible. */
  maxSimultaneousEnemies: z.number().int().positive(),
  maxParticles: z.number().int().nonnegative(),
  /** Cap on solidified fort pieces before older ones stop casting shadows. */
  maxFortPieces: z.number().int().positive(),
  /** Metres beyond which geometry is not drawn. */
  drawDistance: PositiveSchema,
  antialias: z.boolean(),
  targetFps: z.number().int().positive(),
});

export type QualityTier = z.infer<typeof QualityTierSchema>;

export const QualityTiersSchema = z.array(QualityTierSchema).min(1);

let cache: readonly QualityTier[] | null = null;

export function loadQualityTiers(): readonly QualityTier[] {
  cache ??= parseData('quality-tiers.json', QualityTiersSchema, rawTiers);
  return cache;
}

export function qualityTierById(id: string): QualityTier {
  const found = loadQualityTiers().find((tier) => tier.id === id);
  if (!found) throw new Error(`No quality tier with id "${id}"`);
  return found;
}
