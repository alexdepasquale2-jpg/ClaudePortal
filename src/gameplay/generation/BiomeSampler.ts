import type { BiomeDefinition } from '@core/data/biomes/BiomeDefinition';
import type { MaterialTier } from '@core/types/Vocabulary';
import type { SeededRandom } from '@core/utilities/SeededRandom';

/**
 * Picks what goes where, according to the biome.
 *
 * The important placement rule is `greedDistance`: the good material sits far from the extraction
 * zone, deliberately. A biome that scattered plate evenly would have no Greed pillar — there would
 * be no reason to go deeper than the first room.
 *
 * Pyron Chrome is sampled once per site, not per pickup, and usually comes up empty. Discovery has
 * to be rare enough to be news (DESIGN.md calls it a campaign-level event).
 */
export class BiomeSampler {
  constructor(
    private readonly biome: BiomeDefinition,
    private readonly rng: SeededRandom,
  ) {}

  /** Which tier a scatter point holds, weighted by the biome and by distance from extraction. */
  sampleMaterial(_distanceFromExtraction: number): MaterialTier {
    // TODO: implement per DESIGN.md — weight by biome.materialWeights, biased toward higher tiers
    // as distance approaches biome.greedDistance.
    void this.biome;
    void this.rng;
    throw new Error('BiomeSampler.sampleMaterial not implemented');
  }

  /** Rolled once per site. Usually false. */
  samplePyronChromePresence(): boolean {
    // TODO: implement per DESIGN.md — a single roll against biome.pyronChromeChance.
    throw new Error('BiomeSampler.samplePyronChromePresence not implemented');
  }

  /** Which Goliath catalog entry spawns at a point. */
  sampleGoliath(): string {
    // TODO: implement per DESIGN.md — uniform over biome.goliathIds.
    throw new Error('BiomeSampler.sampleGoliath not implemented');
  }
}
