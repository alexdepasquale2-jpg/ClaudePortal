import { z } from 'zod';
import { FLAVOR_TAGS, type FlavorTag } from '../../types/Vocabulary';
import { IdSchema, parseData } from '../schema';
import rawMapping from './verb-to-tag-mapping.json';

/**
 * Verbs the HUD watches, and the tag each set of verbs produces.
 *
 * DESIGN.md: "HUD reads player verbs and applies exactly one locked mechanical consequence per tag
 * (Militant, Logistics, Diplomatic, Subversive, Expedition). Labels without consequences are
 * forbidden."
 *
 * Two halves of that rule live in two places. Here, the mapping from tracked verbs to a tag. In
 * TagConsequenceApplicator, an exhaustive switch over FlavorTag — so a sixth tag without a
 * consequence is a typecheck failure, not a review note.
 *
 * `consequenceSummary` is documentation of the locked consequence, never its implementation. It
 * exists so the Faction/HUD copy and the code cannot drift apart silently.
 */
export const VerbToTagRuleSchema = z.object({
  id: IdSchema,
  tag: z.enum(FLAVOR_TAGS),
  displayName: z.string().min(1),
  /** Verbs from VerbTracker that count toward this tag. */
  verbs: z.array(IdSchema).min(1),
  /** Weight per occurrence; the highest-scoring tag wins, and exactly one tag is ever active. */
  weightPerVerb: z.number().positive(),
  /** Prose statement of the locked mechanical consequence. See docs/GAPS.md — not yet chosen. */
  consequenceSummary: z.string().min(1),
});

export type VerbToTagRule = z.infer<typeof VerbToTagRuleSchema>;

export const VerbToTagMappingSchema = z.array(VerbToTagRuleSchema).superRefine((rows, ctx) => {
  // Every tag must be reachable. A tag no verb can produce is a label with no consequence.
  const covered = new Set(rows.map((row) => row.tag));
  for (const tag of FLAVOR_TAGS) {
    if (!covered.has(tag)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `no verbs map to the "${tag}" tag; every tag must be reachable (DESIGN.md)`,
      });
    }
  }
});

let cache: readonly VerbToTagRule[] | null = null;

export function loadVerbToTagMapping(): readonly VerbToTagRule[] {
  cache ??= parseData('verb-to-tag-mapping.json', VerbToTagMappingSchema, rawMapping);
  return cache;
}

export function rulesForTag(tag: FlavorTag): readonly VerbToTagRule[] {
  return loadVerbToTagMapping().filter((rule) => rule.tag === tag);
}
