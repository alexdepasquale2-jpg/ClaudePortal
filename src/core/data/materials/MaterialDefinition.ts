import { z } from 'zod';
import { MATERIAL_TIERS, type MaterialTier } from '../../types/Vocabulary';
import { IdSchema, NonNegativeSchema, parseData } from '../schema';
import rawMaterials from './materials.json';

/**
 * The four material tiers.
 *
 * PyronChrome carries a design rule in its data: `forgeable` is false and there is no recipe field
 * at all. DESIGN.md — "You find it; you never forge it." Its only mechanical purpose is protecting a
 * primary NNN: `noiseSignatureMultiplier` and `safeHoldExtension` are the entire contract, and no
 * other material may declare them.
 */
export const MaterialDefinitionSchema = z.object({
  id: IdSchema,
  tier: z.enum(MATERIAL_TIERS),
  displayName: z.string().min(1),
  description: z.string().min(1),
  /** Weight per unit — the Greed pillar's cost of carrying more. */
  weight: NonNegativeSchema,
  /** Whether the player can produce it, as opposed to only finding it. */
  forgeable: z.boolean(),
  /** Present only on Pyron Chrome: multiplier applied to a protected NNN's noise signature. */
  noiseSignatureMultiplier: z.number().min(0).max(1).optional(),
  /** Present only on Pyron Chrome: extra safe hold time, in campaign ticks. */
  safeHoldExtension: NonNegativeSchema.optional(),
});

export type MaterialDefinition = z.infer<typeof MaterialDefinitionSchema>;

export const MaterialDatabaseSchema = z.array(MaterialDefinitionSchema).superRefine((rows, ctx) => {
  const tiers = new Set(rows.map((row) => row.tier));
  for (const tier of MATERIAL_TIERS) {
    if (!tiers.has(tier)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `missing material tier: ${tier}` });
    }
  }
  for (const row of rows) {
    if (row.tier !== 'PyronChrome' && (row.noiseSignatureMultiplier ?? row.safeHoldExtension)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${row.tier} declares NNN protection; only PyronChrome may (DESIGN.md)`,
      });
    }
  }
});

let cache: readonly MaterialDefinition[] | null = null;

export function loadMaterials(): readonly MaterialDefinition[] {
  cache ??= parseData('materials.json', MaterialDatabaseSchema, rawMaterials);
  return cache;
}

export function materialFor(tier: MaterialTier): MaterialDefinition {
  const found = loadMaterials().find((row) => row.tier === tier);
  if (!found) throw new Error(`No material definition for tier ${tier}`);
  return found;
}
