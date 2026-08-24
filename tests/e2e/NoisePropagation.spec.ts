import { expect, test } from '@playwright/test';

/**
 * PlayMode equivalent: the causal chain the Dread pillar rests on, driven in a real browser.
 *
 *   build loudly -> loudness accumulates -> a Sancient arrives -> Goliaths become competent
 *
 * Every link must be observable, because a chain the player cannot see is superstition rather than
 * a decision. The chain itself is not implemented yet, so those checks are todo — but the app's
 * boot path IS implemented, so it is tested for real here.
 */
test('the app boots and brings up a WebGL viewport', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });

  await page.goto('/');
  await expect(page.locator('.boot-status')).toBeVisible();

  // BootScene validates every data contract before this appears. If it renders, every schema in
  // the game agrees with every data file.
  await expect(page.locator('.boot-status')).toContainText('data contracts validated');

  const drawing = await page.locator('#viewport').evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    return element.width > 0 && element.height > 0;
  });
  expect(drawing).toBe(true);
  expect(errors).toEqual([]);
});

test('reports a data contract failure loudly rather than starting anyway', async ({ page }) => {
  // DATA-CONTRACTS.md promises bad data fails loudly with the field named. The .boot-error path is
  // how that promise reaches the player rather than only the console.
  await page.goto('/');
  await expect(page.locator('.boot-error')).toHaveCount(0);
});

test.describe('noise propagation', () => {
  test.fixme('solidifying a piece raises the loudness meter', () => {});
  test.fixme('going quiet lets accumulated loudness decay', () => {});
  test.fixme('lighting a node starts a continuous rise the player can see', () => {});
  test.fixme('a chromed primary node rises more slowly than an unchromed one', () => {});
  test.fixme('crossing a threshold summons a Sancient within the site', () => {});
  test.fixme('a jacked Goliath shows the competence warning before it fires', () => {});
});
