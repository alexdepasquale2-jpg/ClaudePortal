import { z } from 'zod';
import { MATERIAL_TIERS } from '../../types/Vocabulary';
import { IdSchema, NonNegativeSchema, parseData } from '../schema';
import rawTree from './tech-tree.json';

/**
 * The one permanent tech tree.
 *
 * DESIGN.md: "One permanent tech tree (head-starts, curves, formations, perks, finally camera
 * presets)." That ordering is the progression's shape and the `category` union encodes it —
 * `camera-preset` nodes are the deep ones, which is how "views reach parity late via meta unlocks"
 * is expressed as data rather than as a promise.
 *
 * Unlike cards, tech persists. It is campaign state.
 */
export const TechNodeSchema = z.object({
  id: IdSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(['head-start', 'curve', 'formation', 'perk', 'camera-preset']),
  /** Nodes that must already be unlocked. */
  requires: z.array(IdSchema),
  /** Feats that must be earned before this can even be purchased. */
  requiresFeats: z.array(IdSchema),
  /** Cost in campaign stockpile materials. */
  cost: z.object({
    Scrap: NonNegativeSchema,
    Rack: NonNegativeSchema,
    Plate: NonNegativeSchema,
    PyronChrome: NonNegativeSchema,
  }),
  /** Depth from the root, used for layout and for the ordering rule below. */
  tier: z.number().int().min(0),
});

export type TechNode = z.infer<typeof TechNodeSchema>;

export const TechTreeSchema = z
  .array(TechNodeSchema)
  .min(1)
  .superRefine((rows, ctx) => {
    const ids = new Set(rows.map((row) => row.id));
    for (const row of rows) {
      for (const requirement of row.requires) {
        if (!ids.has(requirement)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${row.id} requires unknown tech node "${requirement}"`,
          });
        }
      }
      // "...finally camera presets." Parity arrives late or the design rule is not real.
      if (row.category === 'camera-preset' && row.tier < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${row.id}: camera presets unlock late (DESIGN.md); tier must be >= 3`,
        });
      }
      if (MATERIAL_TIERS.every((tier) => row.cost[tier] === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${row.id}: free tech node; permanent progression must cost stockpile`,
        });
      }
    }
  });

let cache: readonly TechNode[] | null = null;

export function loadTechTree(): readonly TechNode[] {
  cache ??= parseData('tech-tree.json', TechTreeSchema, rawTree);
  return cache;
}
