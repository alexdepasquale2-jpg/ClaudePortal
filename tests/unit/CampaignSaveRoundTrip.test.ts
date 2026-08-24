import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_SAVE_VERSION,
  CampaignSaveSchema,
  emptyCampaignSave,
  type CampaignSave,
} from '@campaign/CampaignSave';
import { CampaignSaveSerializer, SaveVersionError } from '@campaign/CampaignSaveSerializer';

/**
 * Written for real rather than todo'd, because this file guards the Consequence pillar.
 *
 * ADR-0001 makes the campaign graph the permanent record; ADR-0002 says the fort is not part of it.
 * Both promises come down to what survives a round trip through this serializer, so both are
 * asserted here rather than trusted.
 */

function populatedSave(): CampaignSave {
  const base = emptyCampaignSave('slot-a', 20260824);
  return {
    ...base,
    elapsedTicks: 137,
    regions: [{ id: 'region-north', displayName: 'Northern Shelf', siteIds: ['site-1', 'site-2'] }],
    sites: [
      {
        id: 'site-1',
        regionId: 'region-north',
        displayName: 'Service Galleries 4',
        position: { x: 12, y: -3 },
        neighbours: ['site-2'],
        ownership: {
          siteId: 'site-1',
          holder: 'Neet',
          contestedBy: ['Goliath'],
          grip: 0.4,
          heldSinceTick: 90,
          flipCount: 3,
        },
        state: {
          biomeId: 'service-galleries',
          litNodes: ['node-a'],
          chromedNodes: ['node-a'],
          stockpile: { Scrap: 400, Rack: 60, Plate: 12, PyronChrome: 1 },
          production: { Scrap: 3, Rack: 1, Plate: 0, PyronChrome: 0 },
          nobotGroups: ['group-1'],
          permanentCompetenceFloor: 0.22,
          pyronChromeKnown: true,
          lastVisitedTick: 130,
          visitCount: 6,
        },
      },
      {
        id: 'site-2',
        regionId: 'region-north',
        displayName: 'Flooded Cut 1',
        position: { x: 30, y: 8 },
        neighbours: ['site-1'],
        ownership: {
          siteId: 'site-2',
          holder: 'Nobot',
          contestedBy: [],
          grip: 0.8,
          heldSinceTick: 120,
          flipCount: 1,
        },
        state: {
          biomeId: 'flooded-cut',
          litNodes: [],
          chromedNodes: [],
          stockpile: { Scrap: 0, Rack: 0, Plate: 0, PyronChrome: 0 },
          production: { Scrap: 0, Rack: 0, Plate: 0, PyronChrome: 0 },
          nobotGroups: ['group-1'],
          permanentCompetenceFloor: 0,
          pyronChromeKnown: false,
          lastVisitedTick: 118,
          visitCount: 1,
        },
      },
    ],
    pipelines: [
      {
        id: 'pipe-1',
        from: 'site-1',
        to: 'site-2',
        carries: ['Scrap', 'Rack'],
        throughput: 12,
        exposure: 0.3,
        active: true,
      },
    ],
    nobotGroups: [
      {
        id: 'group-1',
        templateId: 'scavenger-cell',
        homeSiteId: 'site-2',
        radicalisation: 0.62,
        armed: true,
        betrayed: false,
        resolvedOperations: 7,
      },
    ],
    stockpile: { Scrap: 2400, Rack: 510, Plate: 88, PyronChrome: 2 },
    meta: {
      earnedFeats: ['first-flip', 'held-the-node'],
      unlockedTech: ['carried-kit', 'surveyed-approach'],
      metrics: { 'ownership-flips': 4, 'pieces-solidified': 812 },
    },
    blueprints: [
      {
        id: 'bp-1',
        displayName: 'Node Shroud',
        notes: 'Walls first, turrets last. Keeps the curve flat until the node is covered.',
        pieces: [{ pieceId: 'wall-plate', x: 0, y: 0, z: 1, rotation: 2 }],
        totalCost: { Scrap: 120, Rack: 40, Plate: 8, PyronChrome: 0 },
        estimatedLoudness: 34,
        createdAtTick: 100,
      },
    ],
    history: [
      {
        runId: 'run-11',
        siteId: 'site-1',
        endType: 'Died',
        tick: 130,
        durationMs: 742_000,
        flipped: true,
        flipReason: 'lost-on-death',
        peakLoudness: 318,
        sancientArrived: true,
      },
    ],
  };
}

describe('CampaignSaveSerializer', () => {
  const serializer = new CampaignSaveSerializer();

  it('round-trips a populated campaign exactly', () => {
    const save = populatedSave();
    const restored = serializer.deserialize(serializer.serialize(save));

    // updatedAt is stamped on write by design, so compare everything else.
    const { updatedAt: _writtenAt, ...rest } = restored;
    const { updatedAt: _originalAt, ...original } = save;
    expect(rest).toEqual(original);
  });

  it('preserves the details a flip depends on', () => {
    // These specific fields are the Consequence pillar. Losing any of them silently would mean a
    // campaign forgetting what a run did to it.
    const restored = serializer.deserialize(serializer.serialize(populatedSave()));
    const site = restored.sites.find((candidate) => candidate.id === 'site-1');

    expect(site?.ownership.holder).toBe('Neet');
    expect(site?.ownership.contestedBy).toEqual(['Goliath']);
    expect(site?.ownership.flipCount).toBe(3);
    expect(site?.state.litNodes).toEqual(['node-a']);
    expect(site?.state.permanentCompetenceFloor).toBeCloseTo(0.22);
    expect(restored.nobotGroups[0]?.radicalisation).toBeCloseTo(0.62);
  });

  it('has no field capable of holding fort geometry', () => {
    // ADR-0002 as an assertion. The absence of a place to put a fort is what makes forts
    // session-only, so a field added later must break this test rather than pass unnoticed.
    const shape = CampaignSaveSchema.shape;
    const topLevelKeys = Object.keys(shape);
    for (const forbidden of ['fort', 'forts', 'fortLayout', 'structures', 'pieces']) {
      expect(topLevelKeys).not.toContain(forbidden);
    }

    const siteStateKeys = Object.keys(shape.sites.element.shape.state.shape);
    for (const forbidden of ['fort', 'fortLayout', 'pieces', 'modules', 'geometry']) {
      expect(siteStateKeys).not.toContain(forbidden);
    }
  });

  it('strips unknown fields rather than persisting them', () => {
    // Someone smuggling a fort into a save via an extra key must not have it survive.
    const smuggled = { ...populatedSave(), fortLayout: [{ pieceId: 'wall', x: 1 }] };
    const restored = serializer.fromObject(smuggled);
    expect(restored).not.toHaveProperty('fortLayout');
  });

  it('refuses a save from an unknown future version instead of guessing', () => {
    const future = { ...populatedSave(), version: CAMPAIGN_SAVE_VERSION + 5 };
    expect(() => serializer.fromObject(future)).toThrow(SaveVersionError);
  });

  it('reports which field failed validation', () => {
    const broken = populatedSave() as unknown as Record<string, unknown>;
    broken['stockpile'] = { Scrap: -1, Rack: 0, Plate: 0, PyronChrome: 0 };
    expect(() => serializer.fromObject(broken)).toThrow(/stockpile\.Scrap/);
  });

  it('rejects a document with no version field', () => {
    expect(() => serializer.fromObject({ slotId: 'x' })).toThrow(/no version field/);
  });

  it('rejects malformed JSON with a readable message', () => {
    expect(() => serializer.deserialize('{ not json')).toThrow(/not valid JSON/);
  });
});
