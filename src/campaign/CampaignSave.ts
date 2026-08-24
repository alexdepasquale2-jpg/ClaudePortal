import { z } from 'zod';
import { FACTIONS, MATERIAL_TIERS, RUN_END_TYPES } from '@core/types/Vocabulary';

/**
 * The save document.
 *
 * Read the schema and note the absence: there is no field capable of holding fort geometry. No
 * pieces, no transforms, no health, no partial construction. That absence is load-bearing — it is
 * ADR-0002 expressed as a type, and `tests/unit/CampaignSaveRoundTrip.test.ts` asserts that nothing
 * of the sort survives a round trip.
 *
 * What IS here is everything a run's consequences can amount to: who holds what, what is stockpiled,
 * what is still lit, how radicalised your allies have become, and what you have earned.
 *
 * Blueprints persist and forts do not, which looks inconsistent until you notice a blueprint carries
 * no state from any run — it is an intention, not a structure. See SAVE-FORMAT.md.
 */
export const CAMPAIGN_SAVE_VERSION = 1;

const MaterialCountsSchema = z.object({
  Scrap: z.number().min(0),
  Rack: z.number().min(0),
  Plate: z.number().min(0),
  PyronChrome: z.number().min(0),
});

const OwnershipSchema = z.object({
  siteId: z.string(),
  holder: z.enum(FACTIONS),
  contestedBy: z.array(z.enum(FACTIONS)),
  grip: z.number().min(0).max(1),
  heldSinceTick: z.number().min(0),
  flipCount: z.number().int().min(0),
});

const SiteStateSchema = z.object({
  biomeId: z.string(),
  litNodes: z.array(z.string()),
  chromedNodes: z.array(z.string()),
  stockpile: MaterialCountsSchema,
  production: MaterialCountsSchema,
  nobotGroups: z.array(z.string()),
  permanentCompetenceFloor: z.number().min(0).max(1),
  pyronChromeKnown: z.boolean(),
  lastVisitedTick: z.number().min(0),
  visitCount: z.number().int().min(0),
});

const SavedSiteSchema = z.object({
  id: z.string(),
  regionId: z.string(),
  displayName: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  neighbours: z.array(z.string()),
  ownership: OwnershipSchema,
  state: SiteStateSchema,
});

const SavedRegionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  siteIds: z.array(z.string()),
});

const SavedPipelineSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  carries: z.array(z.enum(MATERIAL_TIERS)),
  throughput: z.number().min(0),
  exposure: z.number().min(0).max(1),
  active: z.boolean(),
});

const SavedNobotGroupSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  homeSiteId: z.string(),
  radicalisation: z.number().min(0).max(1),
  armed: z.boolean(),
  betrayed: z.boolean(),
  resolvedOperations: z.number().int().min(0),
});

const SavedRunRecordSchema = z.object({
  runId: z.string(),
  siteId: z.string(),
  endType: z.enum(RUN_END_TYPES),
  tick: z.number().min(0),
  durationMs: z.number().min(0),
  flipped: z.boolean(),
  flipReason: z.string(),
  peakLoudness: z.number().min(0),
  sancientArrived: z.boolean(),
});

const SavedBlueprintSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  notes: z.string(),
  pieces: z.array(
    z.object({
      pieceId: z.string(),
      x: z.number(),
      y: z.number(),
      z: z.number(),
      rotation: z.number().int().min(0).max(3),
    }),
  ),
  totalCost: MaterialCountsSchema,
  estimatedLoudness: z.number().min(0),
  createdAtTick: z.number().min(0),
});

export const CampaignSaveSchema = z.object({
  version: z.number().int().positive(),
  /** Slot identifier. Several campaigns can coexist in IndexedDB. */
  slotId: z.string().min(1),
  /** Root seed. The entire archipelago is reproducible from this. */
  campaignSeed: z.number().int(),
  /** Campaign ticks elapsed. Advanced when a run resolves, never continuously. */
  elapsedTicks: z.number().min(0),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),

  regions: z.array(SavedRegionSchema),
  sites: z.array(SavedSiteSchema),
  pipelines: z.array(SavedPipelineSchema),
  nobotGroups: z.array(SavedNobotGroupSchema),

  /** Global stockpile, distinct from per-site stockpiles. */
  stockpile: MaterialCountsSchema,

  meta: z.object({
    earnedFeats: z.array(z.string()),
    unlockedTech: z.array(z.string()),
    metrics: z.record(z.string(), z.number()),
  }),

  /** Plans, not structures. */
  blueprints: z.array(SavedBlueprintSchema),
  /** What has happened here. The graph's memory of itself. */
  history: z.array(SavedRunRecordSchema),
});

export type CampaignSave = z.infer<typeof CampaignSaveSchema>;
export type SavedSite = z.infer<typeof SavedSiteSchema>;
export type SavedRunRecord = z.infer<typeof SavedRunRecordSchema>;
export type SavedNobotGroup = z.infer<typeof SavedNobotGroupSchema>;

export function emptyCampaignSave(slotId: string, campaignSeed: number): CampaignSave {
  const now = Date.now();
  return {
    version: CAMPAIGN_SAVE_VERSION,
    slotId,
    campaignSeed,
    elapsedTicks: 0,
    createdAt: now,
    updatedAt: now,
    regions: [],
    sites: [],
    pipelines: [],
    nobotGroups: [],
    stockpile: { Scrap: 0, Rack: 0, Plate: 0, PyronChrome: 0 },
    meta: { earnedFeats: [], unlockedTech: [], metrics: {} },
    blueprints: [],
    history: [],
  };
}
