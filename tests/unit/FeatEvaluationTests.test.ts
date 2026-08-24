import { describe, expect, it } from 'vitest';
import { RUN_END_TYPES } from '@core/types/Vocabulary';
import { featsForTrack, loadFeatTracks } from '@core/data/tech/FeatDefinition';
import { loadTechTree } from '@core/data/tech/TechTree';

/**
 * DESIGN.md: "Feats on different tracks per end type."
 *
 * The point of the split is that dying is a DIFFERENT way of progressing, not a failure to
 * progress. That only holds if all three tracks actually pay out, which is a data property and is
 * therefore tested for real here. The evaluation logic itself is todo.
 */
describe('Feat tracks', () => {
  it('gives every end type somewhere to progress', () => {
    // A track with no feats means that way of playing stops progressing entirely.
    for (const endType of RUN_END_TYPES) {
      expect(featsForTrack(endType).length).toBeGreaterThan(0);
    }
  });

  it('assigns every feat to exactly one track', () => {
    const seen = new Map<string, number>();
    for (const feat of loadFeatTracks()) {
      seen.set(feat.id, (seen.get(feat.id) ?? 0) + 1);
    }
    for (const [id, count] of seen) {
      expect(count, `${id} appears more than once`).toBe(1);
    }
  });

  it('gives every feat a metric and an accumulation mode', () => {
    for (const feat of loadFeatTracks()) {
      expect(feat.metric.length).toBeGreaterThan(0);
      expect(['single-run', 'campaign-total']).toContain(feat.accumulation);
    }
  });
});

describe('Tech tree gating', () => {
  it('only requires feats that actually exist', () => {
    // A tech node gated behind a nonexistent feat is permanently unreachable.
    const featIds = new Set(loadFeatTracks().map((feat) => feat.id));
    for (const node of loadTechTree()) {
      for (const required of node.requiresFeats) {
        expect(featIds.has(required), `${node.id} requires unknown feat "${required}"`).toBe(true);
      }
    }
  });

  it('puts camera presets at the deep end of the tree', () => {
    // "...finally camera presets." This is how "views reach parity late" is actually delivered.
    for (const node of loadTechTree()) {
      if (node.category === 'camera-preset') expect(node.tier).toBeGreaterThanOrEqual(3);
    }
  });

  it('charges stockpile for every permanent unlock', () => {
    for (const node of loadTechTree()) {
      const total = node.cost.Scrap + node.cost.Rack + node.cost.Plate + node.cost.PyronChrome;
      expect(total, `${node.id} is free`).toBeGreaterThan(0);
    }
  });

  it('has no cycles in its prerequisites', () => {
    const nodes = new Map(loadTechTree().map((node) => [node.id, node]));
    const visiting = new Set<string>();
    const done = new Set<string>();

    const visit = (id: string): void => {
      if (done.has(id)) return;
      expect(visiting.has(id), `cycle through ${id}`).toBe(false);
      visiting.add(id);
      for (const required of nodes.get(id)?.requires ?? []) visit(required);
      visiting.delete(id);
      done.add(id);
    };

    for (const id of nodes.keys()) visit(id);
  });
});

describe('FeatEvaluator', () => {
  it.todo('awards only feats on the track matching how the run ended');
  it.todo('does not progress the Extracted track when the player died');
  it.todo('reads single-run metrics from the run and campaign-total metrics from the campaign');
  it.todo('never re-awards a feat already earned');
  it.todo('awards nothing when a threshold is met by exactly one less than required');
  it.todo('awards multiple feats from one run when several thresholds are crossed');
});
