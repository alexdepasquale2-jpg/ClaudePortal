import { test } from '@playwright/test';

/**
 * PlayMode equivalent: the whole point of the game, end to end.
 *
 * SCOPE-LEDGER.md states the vertical slice's definition of done as a browser behaviour: close the
 * tab, reopen it, and the World menu still shows a site you lost. That is what the last test here
 * will assert, and it is the single most important test in the project — it is the core concept,
 * mechanised.
 */
test.describe('extraction and consequence', () => {
  test.fixme('extracting banks the backpack into the campaign stockpile', () => {});
  test.fixme('dying extracts nothing, however full the backpack was', () => {});
  test.fixme('abandoning extracts nothing but leaves a lit node lit', () => {});
  test.fixme('materials consumed by building are spent regardless of end type', () => {});
  test.fixme('every end type writes a run record to the campaign history', () => {});
  test.fixme('dying at a site you held flips its ownership away from you', () => {});
  test.fixme('the World menu shows the new holder immediately after the run', () => {});
  // The definition of done. Everything else exists to make this line mean something.
  test.fixme('the flipped ownership survives a full page reload', () => {});
});
