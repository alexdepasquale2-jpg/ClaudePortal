import { RUN_END_TYPES } from '@core/types/Vocabulary';
import { featsForTrack } from '@core/data/tech/FeatDefinition';

/**
 * Reports feat attainment rates per track.
 * See ./README.md — this checks that all three end-type tracks actually pay out.
 */
function main(argv: readonly string[]): number {
  const runs = argv.includes('--runs') ? Number(argv[argv.indexOf('--runs') + 1]) : 1000;
  if (!Number.isFinite(runs) || runs <= 0) {
    console.error('usage: npm run tool:feat-balance-simulator -- --runs <n>');
    return 1;
  }

  for (const track of RUN_END_TYPES) {
    console.log(`${track}: ${featsForTrack(track).length} feats defined`);
  }

  // TODO: implement per DESIGN.md — simulate `runs` resolved runs with a seeded RNG, feed metrics
  // through FeatEvaluator, and report attainment per feat. Flag any track whose feats are
  // effectively unreachable.
  return 0;
}

process.exitCode = main(process.argv.slice(2));
