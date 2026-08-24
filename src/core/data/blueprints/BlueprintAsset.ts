import { z } from 'zod';
import { MATERIAL_TIERS, type BlueprintId } from '../../types/Vocabulary';
import { IdSchema, NonNegativeSchema, parseData } from '../schema';

/**
 * A blueprint is a PLAN, not a fort.
 *
 * ADR-0002: forts die with the run, but blueprints persist — because a blueprint carries no state
 * from any previous run. No damage, no partial construction, no resources already spent. Loading one
 * costs full price every time.
 *
 * The schema is what keeps that true. There is no `health`, no `builtAt`, no `remainingCost` field
 * here and there must never be one. A blueprint that remembered how a previous run went would be a
 * persistent fort wearing a different name.
 */
export const BlueprintPieceSchema = z.object({
  pieceId: IdSchema,
  /** Local grid position within the blueprint, not world position. */
  x: z.number(),
  y: z.number(),
  z: z.number(),
  /** Quarter-turns about the vertical axis. */
  rotation: z.number().int().min(0).max(3),
});

export const BlueprintAssetSchema = z.object({
  id: IdSchema,
  displayName: z.string().min(1),
  /** Author's note. Blueprints are planning artefacts; a note is half their value. */
  notes: z.string(),
  pieces: z.array(BlueprintPieceSchema),
  /** Total materials to build the whole thing. Paid in full, every load. */
  totalCost: z.object({
    Scrap: NonNegativeSchema,
    Rack: NonNegativeSchema,
    Plate: NonNegativeSchema,
    PyronChrome: NonNegativeSchema,
  }),
  /** Estimated loudness of solidifying the whole plan. The cost of the Power pillar, previewed. */
  estimatedLoudness: NonNegativeSchema,
  createdAtTick: NonNegativeSchema,
});

export type BlueprintPiece = z.infer<typeof BlueprintPieceSchema>;
export type BlueprintAsset = z.infer<typeof BlueprintAssetSchema>;

export function parseBlueprint(file: string, raw: unknown): BlueprintAsset {
  return parseData(file, BlueprintAssetSchema, raw);
}

export function emptyBlueprint(id: BlueprintId, displayName: string): BlueprintAsset {
  return {
    id,
    displayName,
    notes: '',
    pieces: [],
    totalCost: Object.fromEntries(
      MATERIAL_TIERS.map((tier) => [tier, 0]),
    ) as BlueprintAsset['totalCost'],
    estimatedLoudness: 0,
    createdAtTick: 0,
  };
}
