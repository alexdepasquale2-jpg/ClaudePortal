import { z } from 'zod';
import { VIEW_MODES } from '../../types/Vocabulary';
import { NonNegativeSchema, parseData } from '../schema';
import rawSettings from './game-settings.json';

/**
 * Player-facing defaults.
 *
 * Kept as data rather than constants so the Settings menu, the accessibility options and the
 * capability probe all read the same source. `defaultView` respects the design's locked default
 * (top-down) and is overridden per device only by an explicit player choice, never silently.
 */
export const GameSettingsSchema = z.object({
  defaultView: z.enum(VIEW_MODES),
  masterVolume: z.number().min(0).max(1),
  musicVolume: z.number().min(0).max(1),
  sfxVolume: z.number().min(0).max(1),
  /** Pointer sensitivity for manual aim in first/third person. */
  lookSensitivity: z.number().positive(),
  invertLookY: z.boolean(),
  /** Show the loudness meter numerically as well as visually. */
  showLoudnessNumeric: z.boolean(),
  /** Hold vs toggle for the build mode. */
  buildModeToggle: z.boolean(),
  /** Reduce camera shake and influence-bleed animation. */
  reducedMotion: z.boolean(),
  /** Larger touch targets and a wider virtual stick deadzone. */
  largeTouchTargets: z.boolean(),
  /** Autosave the campaign after every resolved run. Off is not offered — see SAVE-FORMAT.md. */
  autosaveOnResolve: z.literal(true),
  /** Seconds of confirmation hold before abandoning an operation. */
  abandonHoldSeconds: NonNegativeSchema,
});

export type GameSettings = z.infer<typeof GameSettingsSchema>;

let cache: GameSettings | null = null;

export function loadGameSettings(): GameSettings {
  cache ??= parseData('game-settings.json', GameSettingsSchema, rawSettings);
  return cache;
}
