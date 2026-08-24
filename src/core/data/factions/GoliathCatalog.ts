import { z } from 'zod';
import { IdSchema, NonNegativeSchema, PositiveSchema, parseData } from '../schema';
import rawCatalog from './goliath-catalog.json';

/**
 * What a Goliath carries — and deliberately nothing about how well it uses it.
 *
 * ADR-0003 in type form. There is no accuracy, skill, aim or competence field here, and there must
 * never be one. Competence is not a property of the machine; it is computed at runtime by
 * LethalityCompetence from the local competence floor.
 *
 * If a catalog entry could say `accuracy: 0.9`, someone would eventually author a permanently
 * competent Goliath, players would learn to read the stat instead of the armament, and the Panic
 * pillar would quietly die. The absence of that field is load-bearing.
 *
 * `baselineIncompetence` is the inverse relationship the design locks: the most heavily armed
 * things are the worst at using what they carry — until a Sancient tells them how.
 */
export const GoliathWeaponSchema = z.object({
  id: IdSchema,
  displayName: z.string().min(1),
  /** Damage if it actually connects. Nothing here says it will. */
  damage: PositiveSchema,
  /** Effective range in metres. */
  range: PositiveSchema,
  /** Seconds between shots. */
  cooldown: PositiveSchema,
  /** Loudness of firing — weapons feed the noise field like everything else. */
  loudness: NonNegativeSchema,
});

export const GoliathCatalogEntrySchema = z.object({
  id: IdSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  /** Aggregate lethality of the armament. High lethality implies high baseline incompetence. */
  lethality: PositiveSchema,
  /**
   * How bad it is at using the catalog when nothing is jacking it, 0..1 (1 = fully clownish).
   * This is a BASELINE, not a competence value: the runtime floor overrides it upward.
   */
  baselineIncompetence: z.number().min(0).max(1),
  hull: PositiveSchema,
  moveSpeed: PositiveSchema,
  /** Hearing threshold — how much noise it takes before this one notices. */
  hearingThreshold: NonNegativeSchema,
  weapons: z.array(GoliathWeaponSchema).min(1),
});

export type GoliathWeapon = z.infer<typeof GoliathWeaponSchema>;
export type GoliathCatalogEntry = z.infer<typeof GoliathCatalogEntrySchema>;

export const GoliathCatalogSchema = z
  .array(GoliathCatalogEntrySchema)
  .min(1)
  .superRefine((rows, ctx) => {
    // The inverse relationship is the whole joke. Catch an entry that breaks it at load time.
    for (const row of rows) {
      if (row.lethality >= 8 && row.baselineIncompetence < 0.5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${row.id}: high lethality with low baseline incompetence contradicts ADR-0003`,
        });
      }
    }
  });

let cache: readonly GoliathCatalogEntry[] | null = null;

export function loadGoliathCatalog(): readonly GoliathCatalogEntry[] {
  cache ??= parseData('goliath-catalog.json', GoliathCatalogSchema, rawCatalog);
  return cache;
}
