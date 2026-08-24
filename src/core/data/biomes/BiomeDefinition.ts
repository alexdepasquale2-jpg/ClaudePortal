import { z } from 'zod';
import { MATERIAL_TIERS } from '../../types/Vocabulary';
import { IdSchema, NonNegativeSchema, PositiveSchema, parseData } from '../schema';
import rawBiomes from './biome-database.json';

/**
 * The kinds of hole you go down into.
 *
 * A biome shapes the Greed/Dread trade at a site: how far the material is from the entrance, how
 * far noise carries in it, and how much of the catalog is already down there. Site geometry is
 * generated from these by SiteGenerator, deterministically from (campaignSeed, siteId).
 *
 * `pyronChromeChance` is deliberately tiny and per-site: DESIGN.md calls discovery of a usable mass
 * a campaign-level event, which only holds if it is rare enough to be news.
 */
export const BiomeDefinitionSchema = z.object({
  id: IdSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  /** Multiplier on how far noise carries here. Tight galleries carry further than open caverns. */
  noisePropagation: PositiveSchema,
  /** Multiplier on ambient loudness — some places are never quiet. */
  ambientLoudness: NonNegativeSchema,
  /** Relative weight of each material tier in scatter. */
  materialWeights: z.object({
    Scrap: NonNegativeSchema,
    Rack: NonNegativeSchema,
    Plate: NonNegativeSchema,
    PyronChrome: NonNegativeSchema,
  }),
  /** Per-site chance a usable Pyron Chrome mass exists at all. Keep this small. */
  pyronChromeChance: z.number().min(0).max(0.2),
  /** Goliath catalog ids that spawn here. */
  goliathIds: z.array(IdSchema).min(1),
  /** Nobot group template ids that may already be living here. */
  nobotGroupIds: z.array(IdSchema),
  /** How far, in metres, the good material tends to sit from the extraction zone. */
  greedDistance: PositiveSchema,
  /** Baseline competence floor before any Sancient or influence overlap, 0..1. */
  baseCompetenceFloor: z.number().min(0).max(1),
});

export type BiomeDefinition = z.infer<typeof BiomeDefinitionSchema>;

export const BiomeDatabaseSchema = z
  .array(BiomeDefinitionSchema)
  .min(1)
  .superRefine((rows, ctx) => {
    for (const row of rows) {
      const total = MATERIAL_TIERS.reduce((sum, tier) => sum + row.materialWeights[tier], 0);
      if (total <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${row.id}: no material weight at all; there would be nothing to be greedy about`,
        });
      }
    }
  });

let cache: readonly BiomeDefinition[] | null = null;

export function loadBiomes(): readonly BiomeDefinition[] {
  cache ??= parseData('biome-database.json', BiomeDatabaseSchema, rawBiomes);
  return cache;
}

export function biomeById(id: string): BiomeDefinition {
  const found = loadBiomes().find((biome) => biome.id === id);
  if (!found) throw new Error(`No biome definition with id "${id}"`);
  return found;
}
