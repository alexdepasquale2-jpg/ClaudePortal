import './style.css';
import { CLASSES } from './data/classes';
import { TICK_MS } from './data/formulas';
import { LocalQueue } from './net/queue';
import { Renderer } from './render/scene';
import { createWorld } from './sim/world';
import { tick } from './sim/tick';
import { KeyboardMouse } from './input/keyboard';
import { TouchInput } from './input/touch';
import { emptyIntent, mergeIntents, type Intent, type InputSource } from './input/source';
import { buildHud } from './ui/hud';
import { el } from './ui/store';

const params = new URLSearchParams(location.search);
if (params.get('class')) start(params.get('class')!, params.get('name') ?? 'Adventurer');
else createCharacterScreen();

function createCharacterScreen() {
  let classId = 'warrior';
  const playable = Object.values(CLASSES).filter(c => c.playable);
  const cards = playable.map(c => el('div.cls', {
    onclick: () => { classId = c.id; cards.forEach(x => x.classList.toggle('on', x.dataset.id === classId)); },
    'data-id': c.id,
  }, el('b', { style: { color: `#${c.color.toString(16).padStart(6, '0')}` } }, c.name),
     el('div.muted', {}, c.resource === 'rage' ? 'Rage · melee' : 'Mana · caster')));
  cards[0].classList.add('on');

  const nameInput = el('input', { value: 'Thrainn', maxlength: '14' }) as HTMLInputElement;
  const screen = el('div#create', {}, el('div.box', {},
    el('h1', {}, 'Azeroth-Lite'),
    el('div.muted', {}, 'Kill a boar. Loot copper. Learn a spell. Get the green sword.'),
    el('div.classes', {}, ...cards),
    el('div.muted', {}, 'Name'), nameInput,
    el('button.go', { onclick: () => { screen.remove(); start(classId, nameInput.value || 'Adventurer'); } }, 'Enter the world'),
    el('div.muted', { style: { marginTop: '10px' } },
      'WASD move · right-drag look · click to target · 1-0 abilities · F loot or talk · Tab nearest · B bags · C character · L quests · P spellbook · N talents')));
  document.body.append(screen);
}

function start(classId: string, name: string) {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  // ?seed=123 pins the world for reproducible runs; without it every session rolls a fresh one.
  const seedParam = new URLSearchParams(location.search).get('seed');
  const seed = seedParam ? Number(seedParam) >>> 0 : (Date.now() ^ 0x5f3759df) >>> 0;
  const world = createWorld(seed, classId, name);
  const queue = new LocalQueue();
  const renderer = new Renderer(canvas, world);
  const hud = buildHud(world, queue, renderer);

  const sources: InputSource[] = [
    new KeyboardMouse(canvas, (x, y) => hud.interact(renderer.pick(x, y))),
  ];

  // Touch controls are wired from the first touch event onward — same intents, no gameplay fork.
  const enableTouch = () => {
    if (document.body.classList.contains('touch')) return;
    document.body.classList.add('touch');
    sources.push(new TouchInput(hud.ctx.root, canvas,
      (x, y) => hud.interact(renderer.pick(x, y)),
      [
        { label: 'Target', onPress: () => hud.targetNearest() },
        { label: 'Use', onPress: () => hud.interactNearest() },
      ]));
  };
  addEventListener('touchstart', enableTouch, { once: true });
  if (matchMedia('(pointer: coarse)').matches) enableTouch();

  let pitch = renderer.pitch;

  // Fixed-timestep sim at 20Hz, rendering free-running at rAF with interpolation between ticks.
  let simAcc = 0, simLast = performance.now();
  function loop(now: number) {
    const dt = Math.min(0.25, (now - simLast) / 1000);
    simLast = now;
    simAcc += dt * 1000;

    let intent: Intent = emptyIntent();
    for (const s of sources) intent = mergeIntents(intent, s.poll());
    renderer.yaw += intent.yawDelta;
    if (intent.pitchDelta) pitch = intent.pitchDelta;
    renderer.pitch = Math.max(-0.15, Math.min(1.2, pitch));
    renderer.zoom = Math.max(3, Math.min(28, renderer.zoom + intent.zoomDelta));
    if (intent.moveX || intent.moveZ) {
      const s = Math.sin(renderer.yaw), c = Math.cos(renderer.yaw);
      const dx = -(intent.moveZ * s + intent.moveX * c);
      const dz = -(intent.moveZ * c - intent.moveX * s);
      queue.push({ t: 'move', dx, dz, facing: Math.atan2(dx, dz) });
    }

    let steps = 0;
    while (simAcc >= TICK_MS && steps++ < 5) {
      tick(world, queue.drain());
      simAcc -= TICK_MS;
    }
    renderer.sync(simAcc / TICK_MS, dt);
    hud.update();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  Object.assign(window as never, { world, queue, renderer, hud });
}
