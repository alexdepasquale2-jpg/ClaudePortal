import { readFileSync } from 'node:fs';
import { parseBlueprint } from '@core/data/blueprints/BlueprintAsset';
import { BuildOrderGraph } from '@core/data/blueprints/BuildOrderGraph';

/**
 * Validates a blueprint and reports its build order and loudness curve.
 * See ./README.md for why the loudness curve is the interesting output.
 */
function main(argv: readonly string[]): number {
  const path = argv[0];
  if (!path) {
    console.error('usage: npm run tool:blueprint-validator -- <blueprint.json>');
    return 1;
  }

  const blueprint = parseBlueprint(path, JSON.parse(readFileSync(path, 'utf8')));
  console.log(`${blueprint.displayName}: ${blueprint.pieces.length} pieces`);

  // TODO: implement per DESIGN.md — print the topological build order and the cumulative loudness
  // after each step, and flag any piece that cannot be supported.
  const graph = BuildOrderGraph.from(blueprint);
  console.log(graph.loudnessCurve());
  return 0;
}

process.exitCode = main(process.argv.slice(2));
