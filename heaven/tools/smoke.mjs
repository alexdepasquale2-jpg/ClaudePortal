// End-to-end: a person on a phone, over three nights.
// Needs a built dist/ and Playwright's Chromium.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';

const out = process.env.SHOTS ?? 'shots';
mkdirSync(out, { recursive: true });

const server = await createServer({ server: { port: 5174 }, logLevel: 'error' });
await server.listen();
const url = 'http://localhost:5174/';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const start = new Date(2026, 8, 20, 22, 10);
await page.clock.install({ time: start });

const H = () => page.evaluate(() => window.__heaven);
const phase = () => page.evaluate(() => window.__heaven.phase);
const body = () => page.evaluate(() => window.__heaven.bodyCss());
const shot = async (n) => {
  // CSS fades run on real time; let them finish.
  await page.clock.runFor(600);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/${n}.png` });
};
const wait = (ms) => page.clock.runFor(ms);
let failures = 0;
const expect = (ok, msg) => {
  console.log(`${ok ? 'ok ' : 'FAIL'} ${msg}`);
  if (!ok) failures++;
};

async function hold(pt, ms) {
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await wait(ms);
  await page.mouse.up();
}
async function swipeDown(x = 200, y = 400) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x, y + i * 25);
  await page.mouse.up();
}
async function waitPhase(p, max = 20000) {
  for (let t = 0; t < max; t += 250) {
    if ((await phase()) === p) return true;
    await wait(250);
  }
  return false;
}

await page.goto(url);
await wait(1500);
await shot('01-gate');
expect((await phase()) === 'gate', 'opens on the sleeping oval');
expect((await page.evaluate(() => localStorage.length)) === 0, 'stores nothing before the gate');

// Lift early: the visit is over.
await hold(await body(), 500);
expect((await phase()) === 'cooling', 'early release cools');
await wait(3000);
expect((await page.evaluate(() => localStorage.getItem('heaven.v1'))) === null, 'nothing guilty stored');

// Hold and stay.
await page.mouse.move((await body()).x, (await body()).y);
await page.mouse.down();
await wait(900);
await shot('02-holding');
await wait(1100);
await page.mouse.up();
await wait(1200);
await shot('03-room');
expect(await waitPhase('name'), 'name line after the room');
await shot('04-name');
// Skip the name by holding the light.
await hold(await body(), 2000);
expect(await waitPhase('speaking'), 'the Presence speaks');
await wait(1200);
await shot('05-first-line');
expect(await waitPhase('write'), 'field opens');
await shot('06-field');
// Give empty.
await hold(await body(), 1600);
expect((await phase()) === 'quiet', 'quiet after giving');
await shot('07-quiet');
expect(await waitPhase('reply', 4000), 'reply');
await wait(1000);
await shot('08-reply-empty');
const q1 = await page.textContent('#r-quote');
expect(q1.includes("I don't know"), `nothing-reply quote: ${q1}`);
await wait(8000);
await shot('09-settled');
const s1 = await page.evaluate(() => window.__heaven.save);
expect(s1.rim.join() === 'door,loaf', 'door and loaf on the rim');
await swipeDown();
await wait(600);
await shot('10-go-in-peace');
expect((await page.textContent('#farewell')) === 'Go in peace.', 'last line is Go in peace.');
expect(await waitPhase('gate', 6000), 'sleeping oval returns');

// Next night: anger.
await page.clock.fastForward(24 * 3600_000);
await hold(await body(), 2000);
expect(await waitPhase('write', 30000), 'second visit field');
await shot('11-second-field');
await page.fill('#story', 'If you loved me you would have stopped it');
await page.focus('#story');
await wait(300);
await hold(await body(), 1600);
expect(await waitPhase('reply', 4000), 'anger reply');
await wait(800);
await shot('12-anger');
expect((await page.textContent('#r-feeling')) === 'angry', 'feeling angry');
await page.click('#r-stay');
await wait(400);
expect((await page.textContent('#r-line')) === 'Then I will sit with the sentence.', 'stay shows only its line');
await wait(8000);

// Drag the door onto the body.
const rim = await page.evaluate(() => window.__heaven.rimCss());
const door = rim.find((r) => r.id === 'door');
const b = await body();
await page.mouse.move(door.x, door.y);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(door.x + ((b.x - door.x) * i) / 8, door.y + ((b.y - door.y) * i) / 8);
await page.mouse.up();
await wait(400);
const s2 = await page.evaluate(() => window.__heaven.save);
expect(s2.on.some((p) => p.id === 'door'), 'door placed on the body');

// Shape the body and let it walk.
const b2 = await body();
await page.mouse.move(b2.x + 20, b2.y + 10);
await page.mouse.down();
for (let i = 1; i <= 6; i++) await page.mouse.move(b2.x + 20 + i * 8, b2.y + 10 - i * 3);
await page.mouse.up();
await wait(1500);
await shot('13-walking');
await wait(4000);
await shot('14-after-walk');

// Tap a seed.
const seeds = await page.evaluate(() => window.__heaven.seedCss());
await page.mouse.click(seeds[0].x, seeds[0].y);
await wait(1000);
await shot('15-seed');
expect(await page.evaluate(() => document.getElementById('seedview').classList.contains('on')), 'seed opens');
await page.mouse.click(200, 150);
await wait(1000);
await page.click('#nottonight');
await wait(500);
expect((await page.textContent('#farewell')) === 'Go in peace.', 'not tonight leaves in peace');
await waitPhase('gate', 6000);

// Third night: continuation and the late warmth.
await page.clock.fastForward(24 * 3600_000);
await hold(await body(), 2000);
expect(await waitPhase('write', 30000), 'third visit field');
await shot('16-continuation');
expect(!(await page.evaluate(() => document.getElementById('cont').hidden)), 'old words sit above the field');
await page.fill('#story', 'and after that I waited in the dark for supper');
await hold(await body(), 1600);
expect(await waitPhase('reply', 4000), 'continued reply');
await wait(9000);
await shot('17-late-warmth');
const s3 = await page.evaluate(() => window.__heaven.save);
expect(s3.seeds.at(-1).continues !== null, 'story continued an older seed');
await wait(12000);
const s4 = await page.evaluate(() => window.__heaven.save);
expect(s4.seeds.at(-1).residue === true, 'late warmth faded to a residue');

// Settings from the top dark.
await hold({ x: 200, y: 120 }, 2000);
await wait(600);
await shot('18-settings');
expect(await page.evaluate(() => document.getElementById('settings').classList.contains('on')), 'settings open from the dark');
await page.click('[data-act="delete"]');
await wait(300);
await shot('19-confirm');
await page.click('[data-act="forget"]');
await waitPhase('gate', 8000);
expect((await page.evaluate(() => localStorage.getItem('heaven.v1'))) === null, 'every story forgotten');

// Reduced motion.
await page.emulateMedia({ reducedMotion: 'reduce' });
await hold(await body(), 2000);
await waitPhase('write', 30000);
await shot('20-first-life-again');
expect(await page.evaluate(() => document.getElementById('speech').textContent.length > 0), 'first life, kindly');

expect(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close();
await server.close();
process.exit(failures ? 1 : 0);
