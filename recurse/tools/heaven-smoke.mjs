/**
 * Optional end-to-end smoke test for Heaven: serves `dist/`, holds the seed,
 * tells it a story, stretches limbs, pulls parts on, visits every stage's
 * view, leaves and comes back, and fails on any console error.
 *
 *   npm run build && node tools/heaven-smoke.mjs [<screenshot-dir>]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const SHOTS = process.argv[2] || '.';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.map': 'application/json' };

const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('nope');
  }
});
await new Promise((r) => server.listen(4174, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
const errors = [];
// the neutral page used to rewrite saves has no favicon; that 404 is not the game's
page.on('console', (m) => m.type() === 'error' && !page.url().endsWith('icon.svg') && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
const fail = (msg) => {
  console.error('FAIL', msg);
  process.exitCode = 1;
};
const GAME = 'http://localhost:4174/heaven.html';
async function rewrite(fn, arg) {
  await page.goto('http://localhost:4174/icon.svg');
  await page.evaluate(fn, arg);
  await page.goto(GAME, { waitUntil: 'networkidle' });
}
const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('heaven.save.v1') || 'null'));

await page.goto('http://localhost:4174/heaven.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/h1-seed.png` });

const W = 1360, H = 820;
const seedAt = await page.evaluate(() => window.__heaven());
const cx = seedAt.x, cy = seedAt.y;

// tapping does nothing
for (let i = 0; i < 6; i++) {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(60);
}
await page.waitForTimeout(5200);
let s = await save();
if (s && s.warmth > 0) fail(`taps warmed it: ${s.warmth}`);

// holding does
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.waitForTimeout(3000);
await page.screenshot({ path: `${SHOTS}/h2-holding.png` });
await page.waitForTimeout(3000);
await page.mouse.up();
await page.waitForTimeout(5200);
s = await save();
if (!s || s.warmth < 4) fail(`holding did not warm it: ${s && s.warmth}`);

await page.fill('#story', 'the kettle sang this morning and I let it');
await page.press('#story', 'Enter');
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/h3-telling.png` });
await page.waitForTimeout(2500);
s = await save();
if (s.stage !== 2) fail(`did not grow a body: stage ${s.stage}`);
if (JSON.stringify(s).includes('kettle')) fail('the save kept the story');

// wait out the settling, then stretch two legs out of its lower side
await page.waitForTimeout(8000);
const pull = async (angle, dist) => {
  const w = await page.evaluate(() => window.__heaven());
  const sx = w.x + Math.cos(angle) * w.R * 0.95;
  const sy = w.y + Math.sin(angle) * w.R * 0.95;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let k = 1; k <= 12; k++) {
    await page.mouse.move(sx + Math.cos(angle) * dist * (k / 12), sy + Math.sin(angle) * dist * (k / 12));
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(400);
};
await pull(Math.PI / 2 - 0.6, 150);
await pull(Math.PI / 2 + 0.6, 150);
await page.waitForTimeout(300);
s = await save();
if (s.limbs.length !== 2) fail(`expected two limbs, got ${s.limbs.length}`);
await page.screenshot({ path: `${SHOTS}/h4-legs.png` });

// pull parts off the wall onto it
const spot = (kind) => page.evaluate((k) => window.__heaven().spot(k), kind);
const give = async (kind, angle) => {
  const p = await spot(kind);
  const w = await page.evaluate(() => window.__heaven());
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  const tx = w.x + Math.cos(angle) * (w.R + 10);
  const ty = w.y + Math.sin(angle) * (w.R + 10);
  for (let k = 1; k <= 15; k++) {
    await page.mouse.move(p.x + (tx - p.x) * (k / 15), p.y + (ty - p.y) * (k / 15));
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
};
await give('loaf', -1.2); // does not belong yet
s = await save();
if (s.parts.some((p) => p.kind === 'loaf')) fail('loaf clicked without a table');
await give('table', -0.3);
await give('loaf', -Math.PI + 0.3);
await give('crown', -Math.PI / 2);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/h5-crown.png` });
s = await save();
if (!s.parts.some((p) => p.kind === 'crown')) fail('the crown did not attach');

// make it a factory, then break the lock
await rewrite(() => {
  const s = JSON.parse(localStorage.getItem('heaven.save.v1'));
  s.parts = s.parts.filter((p) => p.kind !== 'crown');
  s.parts.push({ kind: 'door', angle: 0 }, { kind: 'lock', angle: 0.2 });
  s.graph = [2, 3, 5, 8, 12, 17, 23, 30];
  s.oil = 34;
  s.factoryOil = 20;
  s.lastSeen = Date.now();
  localStorage.setItem('heaven.save.v1', JSON.stringify(s));
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/h6-factory.png` });
if (await page.locator('#factory').isHidden()) fail('factory banner hidden while locked');
await page.click('#breakLock');
await page.waitForTimeout(400);
if (await page.locator('#factory').isVisible()) fail('factory banner still up after breaking the lock');

// later stages, seeded straight into the save
const seedStage = async (stage) => {
  await rewrite((stage) => {
    const s = JSON.parse(localStorage.getItem('heaven.save.v1'));
    s.stage = stage;
    s.loaf = 9;
    s.oil = 120;
    s.table = 3;
    s.warmth = 20;
    s.stillUntil = 0;
    s.parts = [
      { kind: 'table', angle: 0.3 },
      { kind: 'lamp', angle: -1.2 },
      { kind: 'door', angle: 3.0 },
      { kind: 'bed', angle: -2.2 },
    ];
    s.house.step = ['grief', 'anger', 'unknowing'];
    const lay = ['leaving', 'fight', 'meal', 'need', 'fun', null, null, null, null, null, null, null];
    s.house.cells = lay.map((h) => ({ hour: h, strain: 0 }));
    s.house.cells[5].hour = 'need';
    s.house.cells[5].strain = 0.5;
    s.house.arrived = 8;
    s.lastSeen = Date.now() - 2 * 3600 * 1000;
    localStorage.setItem('heaven.save.v1', JSON.stringify(s));
  }, stage);
  await page.waitForTimeout(900);
};
await seedStage(3);
await page.screenshot({ path: `${SHOTS}/h7-return.png` });
await page.click('#ok');
await page.waitForTimeout(3500);
await page.screenshot({ path: `${SHOTS}/h8-creature-rests.png` });
await page.click('.tab[data-v="house"]');
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/h9-house.png` });

await seedStage(4);
await page.click('#ok');
await page.click('.tab[data-v="city"]');
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/h10-city.png` });

await seedStage(5);
await page.click('#ok');
await page.click('.tab[data-v="sky"]');
await page.waitForTimeout(800);
// pull warm weather from the lamp well over the sky
const board = { x: 450, y: 90, w: W - 410 - 450, h: H - 90 - 130 };
const well = { x: board.x + board.w * (0.5 / 4), y: board.y + board.h - 40 };
await page.mouse.move(well.x, well.y);
await page.mouse.down();
await page.mouse.move(board.x + board.w * 0.5, board.y + board.h * 0.35, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(5600);
await page.screenshot({ path: `${SHOTS}/h11-firmament.png` });
s = await save();
if (s.sky.fronts.length < 1) fail('no weather front was made');

// the door always works
await page.click('#leave');
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/h12-left.png` });
await page.click('#back');
await page.waitForTimeout(400);

if (errors.length) fail('console errors:\n' + errors.join('\n'));
console.log(process.exitCode ? 'heaven smoke: FAILED' : 'heaven smoke: ok');
await browser.close();
server.close();
