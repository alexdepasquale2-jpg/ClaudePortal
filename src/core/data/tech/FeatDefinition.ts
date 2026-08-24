import { z } from 'zod';
import { RUN_END_TYPES, type RunEndType } from '../../types/Vocabulary';
import { IdSchema, parseData } from '../schema';
import rawTracks from './feat-tracks.json';

/**
 * Feats, split by how the run ended.
 *
 * DESIGN.md: "Feats on different tracks per end type." That is the whole point of this file — a
 * player who only ever extracts and a player who dies constantly are on different progression
 * tracks, and both are progressing. Dying is not failure to progress; it is a different track.
 *
 * `track` is a RunEndType, so the split is structural. A feat that could be earned on any track
 * would collapse the three tracks into one.
 */
export const FeatDefinitionSchema = z.object({
  id: IdSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  /** Which end type this feat is earned on. */
  track: z.enum(RUN_END_TYPES),
  /** Statistic FeatEvaluator watches. */
  metric: IdSchema,
  /** Value of that metric required to earn it. */
  threshold: z.number(),
  /** Whether the metric accumulates across runs or must be met within a single run. */
  accumulation: z.enum(['single-run', 'campaign-total']),
});

export type FeatDefinition = z.infer<typeof FeatDefinitionSchema>;

export const FeatTracksSchema = z
  .array(FeatDefinitionSchema)
  .min(1)
  .superRefine((rows, ctx) => {
    // Every end type must have somewhere to go, or that way of playing stops progressing.
    const tracks = new Set(rows.map((row) => row.track));
    for (const endType of RUN_END_TYPES) {
      if (!tracks.has(endType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `no feats on the "${endType}" track; every end type is a track (DESIGN.md)`,
        });
      }
    }
  });

let cache: readonly FeatDefinition[] | null = null;

export function loadFeatTracks(): readonly FeatDefinition[] {
  cache ??= parseData('feat-tracks.json', FeatTracksSchema, rawTracks);
  return cache;
}

export function featsForTrack(track: RunEndType): readonly FeatDefinition[] {
  return loadFeatTracks().filter((feat) => feat.track === track);
}
