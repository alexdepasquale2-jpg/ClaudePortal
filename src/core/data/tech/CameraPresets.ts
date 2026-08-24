import { z } from 'zod';
import { VIEW_MODES } from '../../types/Vocabulary';
import { IdSchema, PositiveSchema, parseData } from '../schema';
import rawPresets from './camera-presets.json';

/**
 * Camera rigs, one or more per view mode.
 *
 * DESIGN.md: top-down is the default and it is STEEP — that is what makes it the auto-fire
 * Survivors spine rather than an isometric shooter. `pitchDegrees` on the default top-down preset is
 * therefore not a taste decision.
 *
 * Presets beyond the defaults are unlocked by camera-preset tech nodes, which is how "views reach
 * parity late via meta unlocks" actually happens.
 */
export const CameraPresetSchema = z.object({
  id: IdSchema,
  displayName: z.string().min(1),
  view: z.enum(VIEW_MODES),
  /** True for the preset used before any tech is unlocked. Exactly one per view. */
  isDefault: z.boolean(),
  /** Tech node that grants this preset. Null for defaults. */
  unlockedBy: IdSchema.nullable(),
  /** Downward pitch. Top-down is steep by design. */
  pitchDegrees: z.number().min(0).max(90),
  /** Distance behind/above the pawn, in metres. Zero for first-person. */
  distance: z.number().min(0),
  /** Vertical offset from the pawn's origin. */
  height: z.number(),
  fieldOfView: PositiveSchema,
  /** Fraction of camera offset remaining after one second — lower is snappier. */
  followSmoothing: z.number().min(0).max(1),
});

export type CameraPreset = z.infer<typeof CameraPresetSchema>;

export const CameraPresetsSchema = z
  .array(CameraPresetSchema)
  .min(1)
  .superRefine((rows, ctx) => {
    for (const view of VIEW_MODES) {
      const defaults = rows.filter((row) => row.view === view && row.isDefault);
      if (defaults.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `view "${view}" must have exactly one default preset, found ${defaults.length}`,
        });
      }
    }
    const topDownDefault = rows.find((row) => row.view === 'TopDown' && row.isDefault);
    if (topDownDefault && topDownDefault.pitchDegrees < 60) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'the default top-down view is steep (DESIGN.md); pitch must be >= 60 degrees',
      });
    }
  });

let cache: readonly CameraPreset[] | null = null;

export function loadCameraPresets(): readonly CameraPreset[] {
  cache ??= parseData('camera-presets.json', CameraPresetsSchema, rawPresets);
  return cache;
}
