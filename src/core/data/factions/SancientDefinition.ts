import { z } from 'zod';
import { IdSchema, NonNegativeSchema, PositiveSchema, parseData } from '../schema';
import rawTiers from './sancient-power-tiers.json';

/**
 * Sancients: rare, personally weak, fully aware of the catalog.
 *
 * DESIGN.md: "Their power determines how many nodes or groups they can jack simultaneously and for
 * how long. Long-duration multi-jacks are possible. Permanent jacks raise the local competence floor
 * permanently."
 *
 * So a power tier is three numbers — breadth, duration, permanence — and almost nothing else. Note
 * how low `hull` and `damage` are: a Sancient is not a fight, it is a change in what the fight
 * means. Killing one is easy. Reaching one is not.
 */
export const SancientPowerTierSchema = z.object({
  id: IdSchema,
  tier: z.number().int().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  /** How many Goliaths, nodes or Nobot groups it can jack at once. */
  maxSimultaneousJacks: z.number().int().min(1),
  /** Seconds a jack holds. */
  jackDurationSeconds: PositiveSchema,
  /** Chance a given jack becomes permanent, raising the local competence floor forever. */
  permanentJackChance: z.number().min(0).max(1),
  /** How much the floor rises inside the jacked volume, 0..1. */
  competenceFloorContribution: z.number().min(0).max(1),
  /** Radius of the raised floor, in metres. */
  jackRadius: PositiveSchema,
  /** Personally weak. These stay small on purpose. */
  hull: PositiveSchema,
  damage: NonNegativeSchema,
  moveSpeed: PositiveSchema,
  /** Accumulated run loudness at which this tier becomes eligible to arrive. */
  loudnessToSummon: NonNegativeSchema,
  /** Multiplier applied to Nobot radicalisation while this one is present (ADR-0004). */
  radicalisationAccelerant: z.number().min(1),
});

export type SancientPowerTier = z.infer<typeof SancientPowerTierSchema>;

export const SancientPowerTiersSchema = z
  .array(SancientPowerTierSchema)
  .min(1)
  .superRefine((rows, ctx) => {
    for (const row of rows) {
      // "Personally weak" is a design rule, not flavour text. Guard it at load.
      if (row.hull > 200 || row.damage > 20) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${row.id}: Sancients are personally weak (DESIGN.md); hull/damage too high`,
        });
      }
    }
  });

let cache: readonly SancientPowerTier[] | null = null;

export function loadSancientPowerTiers(): readonly SancientPowerTier[] {
  cache ??= parseData('sancient-power-tiers.json', SancientPowerTiersSchema, rawTiers);
  return cache;
}
