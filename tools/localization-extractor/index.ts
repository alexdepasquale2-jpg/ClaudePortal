import { loadStrings } from '@core/data/localization/StringTable';

/**
 * Diffs translation keys used in source against those defined in the string table.
 * See ./README.md.
 */
function main(argv: readonly string[]): number {
  const check = argv.includes('--check');
  const strings = loadStrings();
  console.log(`en.json: ${Object.keys(strings).length} keys`);

  // TODO: implement per DESIGN.md — walk src/ for t('...') calls, diff both directions, and exit
  // non-zero under --check when anything is missing or orphaned.
  void check;
  return 0;
}

process.exitCode = main(process.argv.slice(2));
