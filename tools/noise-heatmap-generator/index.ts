import { loadBiomes } from '@core/data/biomes/BiomeDefinition';

/**
 * Samples the noise field across a site and writes a heatmap.
 * See ./README.md — this exists so noise tuning is visible rather than guessed.
 */
function main(argv: readonly string[]): number {
  const biomeId = argv.includes('--biome') ? argv[argv.indexOf('--biome') + 1] : undefined;
  const biomes = loadBiomes();
  const biome = biomeId ? biomes.find((candidate) => candidate.id === biomeId) : biomes[0];
  if (!biome) {
    console.error(`unknown biome "${biomeId}". known: ${biomes.map((b) => b.id).join(', ')}`);
    return 1;
  }

  console.log(
    `${biome.displayName}: propagation ${biome.noisePropagation}, ambient ${biome.ambientLoudness}`,
  );

  // TODO: implement per DESIGN.md — build a NoiseSystem with representative emitters, sample it on
  // a grid via sampleAt(), and write a PNG. Requires NoiseSystem.sampleAt to exist first.
  return 0;
}

process.exitCode = main(process.argv.slice(2));
