import { readFileSync } from 'node:fs';
import { CampaignSaveSerializer } from '@campaign/CampaignSaveSerializer';

/**
 * Turns a campaign save into a graph description for offline inspection.
 * See ./README.md.
 */
function main(argv: readonly string[]): number {
  const path = argv[0];
  if (!path) {
    console.error('usage: npm run tool:campaign-graph-visualizer -- <campaign.json>');
    return 1;
  }

  const save = new CampaignSaveSerializer().deserialize(readFileSync(path, 'utf8'));
  console.log(`campaign ${save.slotId}: ${save.sites.length} sites, ${save.elapsedTicks} ticks`);

  // TODO: implement per DESIGN.md — emit DOT with a node per site coloured by holder, an edge per
  // neighbour link, and contested sites marked. Ownership colours must match Materials.FACTION_COLORS.
  return 0;
}

process.exitCode = main(process.argv.slice(2));
