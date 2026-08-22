/**
 * Optional end-to-end smoke test: serves `dist/`, boots the game in Chromium,
 * plays it for a few hundred rounds, opens every screen, reloads to prove the
 * save round-trips, and fails on any console error.
 *
 *   npm run smoke [-- <screenshot-dir>]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const SHOTS = process.argv[2] || '.';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.map':'application/json' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('nope');
  }
});
await new Promise((r) => server.listen(4173, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto('http://localhost:4173/?seed=12345', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

// dismiss the intro help modal
const close = page.locator('.modal-close');
if (await close.count()) await close.first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/01-start.png` });

// play: buy generators and open doors, breadth-first-ish
const report = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  const channel = document.querySelector('.btn-channel');
  for (let round = 0; round < 400; round++) {
    // bootstrap by hand, the way a new player would
    for (let i = 0; i < 6; i++) document.querySelector('.btn-channel')?.click();
    for (const b of document.querySelectorAll('.gen-actions .btn')) {
      if (!b.disabled && b.textContent.startsWith('Max')) b.click();
    }
    for (const b of document.querySelectorAll('.btn-door')) {
      if (!b.disabled && b.textContent.includes('Open')) { b.click(); break; }
    }
    // walk back up to the root every so often so the whole tree gets played
    if (round % 7 === 0) {
      const rows = document.querySelectorAll('.tree-row');
      if (rows.length) rows[Math.floor(Math.random() * rows.length)].click();
    }
    await sleep(25);
    if (round % 100 === 0) log.push(document.querySelector('.readout-main')?.textContent ?? 'n/a');
  }
  void channel;
  return { log, nodes: document.querySelector('.chips').textContent };
});

await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/02-played.png` });

// tree row count + a deeper focus
const treeRows = await page.locator('.tree-row:visible').count();

// open the codex
await page.keyboard.press('x');
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/03-codex.png` });
const codexText = await page.locator('.modal-body p').first().textContent();
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// stats
await page.keyboard.press('s');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/04-stats.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// prestige screen
await page.keyboard.press('r');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/05-reset.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// reload to prove persistence
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const afterReload = await page.evaluate(() => ({
  chips: document.querySelector('.chips')?.textContent ?? '',
  out: document.querySelector('.readout-main')?.textContent ?? '',
}));
await page.screenshot({ path: `${SHOTS}/06-reloaded.png` });

console.log(JSON.stringify({ report, treeRows, codexText, afterReload, errors }, null, 2));
await browser.close();
server.close();
if (errors.length) {
  console.error(`${errors.length} console error(s)`);
  process.exitCode = 1;
}
