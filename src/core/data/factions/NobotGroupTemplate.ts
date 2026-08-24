import { z } from 'zod';
import { IdSchema, NonNegativeSchema, PositiveSchema, parseData } from '../schema';
import rawTemplates from './nobot-group-template.json';

/**
 * Nobot group archetypes.
 *
 * ADR-0004: arming a Nobot group is a debt, not a purchase. Newly armed they are allies and
 * distractors; radicalisation rises when an operation RESOLVES; past the threshold they betray and
 * want their own protected nodes. Sancients accelerate all of it.
 *
 * `radicalisationPerResolvedOperation` and `decayPerCampaignTick` together decide whether arming is
 * a one-shot decision or a maintenance chore. The design does not settle this — see docs/GAPS.md —
 * so the values here are a starting position to be tuned, not a locked answer.
 */
export const NobotGroupTemplateSchema = z.object({
  id: IdSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  /** Radicalisation the group starts at, 0..1. */
  startingRadicalisation: z.number().min(0).max(1),
  /** Added on each resolved operation this group took part in. */
  radicalisationPerResolvedOperation: z.number().min(0).max(1),
  /** Added on each arming. Handing out neutrino tech is itself a provocation. */
  radicalisationPerArming: z.number().min(0).max(1),
  /** Bled off per campaign tick. Zero means arming can never be walked back. */
  decayPerCampaignTick: z.number().min(0).max(1),
  /** Crossing this fires BetrayalTrigger. */
  betrayalThreshold: z.number().min(0).max(1),
  /** Combat weight while still allied. */
  hull: PositiveSchema,
  damage: NonNegativeSchema,
  moveSpeed: PositiveSchema,
  /** How many of them a single arming brings over. */
  groupSize: z.number().int().min(1),
  /** How loud they are just by existing near you — allies are not free cover. */
  loudness: NonNegativeSchema,
});

export type NobotGroupTemplate = z.infer<typeof NobotGroupTemplateSchema>;

export const NobotGroupTemplatesSchema = z
  .array(NobotGroupTemplateSchema)
  .min(1)
  .superRefine((rows, ctx) => {
    for (const row of rows) {
      if (row.startingRadicalisation >= row.betrayalThreshold) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${row.id}: starts already past betrayal; arming would never be a decision`,
        });
      }
    }
  });

let cache: readonly NobotGroupTemplate[] | null = null;

export function loadNobotGroupTemplates(): readonly NobotGroupTemplate[] {
  cache ??= parseData('nobot-group-template.json', NobotGroupTemplatesSchema, rawTemplates);
  return cache;
}
