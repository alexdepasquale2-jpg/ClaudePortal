/**
 * Heaven — wiring. The engine stays DOM-free; this file is the hands.
 *
 * Nothing here keeps a story. The words you type fly into the mouth as
 * particles and are gone when the animation ends.
 */

import { build, BUILD_COST, BUILD_LINE, census, clear, type Build } from './engine/city';
import { gait } from './engine/gait';
import {
  absence,
  breakLock,
  freedom,
  hold,
  hoursLit,
  isFactory,
  mouthOpen,
  needs,
  oilCap,
  release,
  settling,
  STAGE_NAME,
  tell,
  tick,
  warmthCap,
} from './engine/heaven';
import { place, room, unplace, move } from './engine/house';
import { ALL_PARTS, attach, count, detach, expandTable, fit, PARTS, slots, tableCost, TRUE_PARTS } from './engine/parts';
import { addFront, WEATHER_LINE, WEATHERS } from './engine/sky';
import { boot, forget, persist } from './engine/state';
import type { Absence, Heaven, Hour, PartKind, Weather } from './engine/types';
import {
  BUILDS,
  buildPos,
  cellAt,
  cityGrid,
  drawCity,
  drawHouse,
  drawSky,
  houseGrid,
  houseThreatLines,
  type Rect,
  skyBox,
  stepPos,
  wellPos,
} from './render/boards';
import { Creature, reach, type Pose } from './render/creature';
import { drawPart, INK } from './render/glyphs';

type View = 'body' | 'house' | 'city' | 'sky';

type Drag =
  | { k: 'core'; sx: number; sy: number; moved: boolean }
  | { k: 'skin' }
  | { k: 'tip'; li: number }
  | { k: 'worn'; pi: number; kind: PartKind; x: number; y: number }
  | { k: 'room'; kind: PartKind; x: number; y: number }
  | { k: 'step'; si: number; hour: Hour; x: number; y: number }
  | { k: 'cell'; ci: number; hour: Hour; x: number; y: number }
  | { k: 'build'; b: Build; x: number; y: number }
  | { k: 'tile'; ci: number }
  | { k: 'weather'; kind: Weather; x: number; y: number };

interface Word {
  text: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  delay: number;
  age: number;
}

interface Returning {
  kind: PartKind;
  x: number;
  y: number;
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const app = document.getElementById('app')!;

let h: Heaven = boot();
let view: View = 'body';
let drag: Drag | null = null;
let pointer = { x: 0, y: 0 };
let running = false;
let away = false;
let lastFrame = 0;
let lastHud = 0;
let lastSave = 0;
let words: Word[] = [];
let returning: Returning[] = [];
let pendingShudder = -1;
let grewBanner = { text: '', age: 99 };
let whisperTimer = 0;
let spaceHeld = false;
let W = 0;
let H = 0;

app.classList.remove('boot');
app.innerHTML = `
  <div class="room">
    <canvas id="cv" aria-label="Heaven. Press and hold the warmth. Drag to stretch it; pull things from the room onto it."></canvas>
    <div class="hud-l">
      <div class="stage" id="stage"></div>
      <ul class="needs" id="needs"></ul>
      <div class="afterglow" id="log" aria-live="polite"></div>
    </div>
    <div class="hud-r" id="stats"></div>
    <nav class="views" id="views" aria-label="Where to look"></nav>
    <button class="leave" id="leave" title="The door is always here">Leave</button>
    <div class="whisper" id="whisper" role="status"></div>
    <form class="mouth" id="mouth" autocomplete="off">
      <input id="story" maxlength="400" placeholder="Tell it one thing." aria-label="Tell it one thing" />
      <button class="btn" id="tellBtn" type="submit">Tell</button>
    </form>
    <div class="factory" id="factory" hidden>
      <div>
        <h2>Factory.</h2>
        <p id="factoryWhy">The graph is up. Nobody can leave.</p>
        <canvas id="bigGraph" width="320" height="80"></canvas>
        <p class="mute" id="factoryCost"></p>
        <button class="btn primary" id="breakLock">Break the lock</button>
      </div>
    </div>
    <div class="veil" id="veil" hidden></div>
  </div>`;

const cv = app.querySelector('#cv') as HTMLCanvasElement;
const ctx = cv.getContext('2d')!;
const els = {
  stage: app.querySelector('#stage') as HTMLElement,
  needs: app.querySelector('#needs') as HTMLElement,
  log: app.querySelector('#log') as HTMLElement,
  stats: app.querySelector('#stats') as HTMLElement,
  views: app.querySelector('#views') as HTMLElement,
  whisper: app.querySelector('#whisper') as HTMLElement,
  mouth: app.querySelector('#mouth') as HTMLFormElement,
  story: app.querySelector('#story') as HTMLInputElement,
  tellBtn: app.querySelector('#tellBtn') as HTMLButtonElement,
  factory: app.querySelector('#factory') as HTMLElement,
  factoryWhy: app.querySelector('#factoryWhy') as HTMLElement,
  factoryCost: app.querySelector('#factoryCost') as HTMLElement,
  breakLock: app.querySelector('#breakLock') as HTMLButtonElement,
  bigGraph: app.querySelector('#bigGraph') as HTMLCanvasElement,
  veil: app.querySelector('#veil') as HTMLElement,
  leave: app.querySelector('#leave') as HTMLButtonElement,
};

const creature = new Creature(innerWidth / 2, innerHeight / 2);

// ─── layout ────────────────────────────────────────────────────────────────

/** Boards stay between the HUD columns on a wide screen, and use the width on a narrow one. */
function boardRect(): Rect {
  const wide = W > 1100;
  const x = wide ? 450 : 16;
  const right = wide ? W - 410 : W - 16;
  const y = wide ? 90 : 200;
  return { x, y, w: right - x, h: H - y - 130 };
}

function floorY(): number {
  return H * 0.8;
}

/** Parts live in the room: true ones along the west wall, vain ones glitter on the east. */
function roomSpot(kind: PartKind): { x: number; y: number } {
  const t = TRUE_PARTS.indexOf(kind);
  const top = W > 900 ? 150 : 250;
  const bottom = floorY() - 30;
  if (t >= 0) return { x: 58, y: top + (t / (TRUE_PARTS.length - 1)) * (bottom - top) };
  const v = ALL_PARTS.indexOf(kind) - TRUE_PARTS.length;
  return { x: W - 58, y: top + 30 + (v / 3) * (bottom - top - 60) };
}

/** A part is on the wall when the body can still take another of it. */
function inRoom(kind: PartKind): boolean {
  if (h.stage < 2) return false;
  const lim = kind === 'lamp' ? 3 : kind === 'table' ? 2 : 1;
  if (count(h, kind) >= lim) return false;
  if (drag?.k === 'room' && drag.kind === kind) return false;
  return !returning.some((r) => r.kind === kind);
}

function pose(): Pose {
  return {
    stage: h.stage,
    warmth: h.warmth / warmthCap(h),
    loaf: h.loaf,
    gait: gait(h),
    limbs: h.limbs,
    parts: h.parts,
    settling: settling(h, Date.now()),
    mouthOpen: mouthOpen(h),
    factory: isFactory(h),
    reduced,
  };
}

function resize(): void {
  const dpr = devicePixelRatio || 1;
  W = cv.clientWidth;
  H = cv.clientHeight;
  cv.width = Math.floor(W * dpr);
  cv.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  creature.x = Math.max(160, Math.min(W - 160, creature.x));
}

// ─── whispers and afterglow ────────────────────────────────────────────────

function whisper(text: string, seconds = 5): void {
  els.whisper.textContent = text;
  els.whisper.classList.add('on');
  whisperTimer = seconds;
}

function fmtHours(hours: number): string {
  if (!isFinite(hours)) return '—';
  if (hours < 1 / 60) return 'a moment';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  const hh = Math.floor(hours);
  const mm = Math.round((hours - hh) * 60);
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
}

function fmtSpan(seconds: number): string {
  return fmtHours(seconds / 3600);
}

// ─── HUD ───────────────────────────────────────────────────────────────────

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

function renderHud(): void {
  (app.firstElementChild as HTMLElement).dataset.view = view;
  els.stage.textContent = `${ROMAN[h.stage]} · ${STAGE_NAME[h.stage]}${h.world ? ' — it can hold a world' : ''}`;
  els.needs.innerHTML = needs(h)
    .map((n) => `<li class="${n.ok ? 'ok' : ''}"><span aria-hidden="true">${n.ok ? '●' : '○'}</span> ${n.label}</li>`)
    .join('');
  els.log.innerHTML = h.log.slice(-3).map((l) => `<div>${l}</div>`).join('');

  const f = freedom(h);
  const cap = warmthCap(h);
  const lit = hoursLit(h);
  const rows: string[] = [
    `<div class="stat"><span>Warmth</span><b>${h.warmth.toFixed(1)} / ${cap.toFixed(0)}</b><i class="bar"><em style="width:${(100 * h.warmth) / cap}%"></em></i><small>stays lit ~${fmtHours(lit)} without you</small></div>`,
    `<div class="stat"><span>Loaf</span><b>${h.loaf}</b><small>stories received</small></div>`,
  ];
  if (h.stage >= 3) rows.push(`<div class="stat"><span>Room</span><b>${room(h.house)}</b><small>kinds of hour it holds</small></div>`);
  if (h.stage >= 4) {
    const c = census(h.city);
    rows.push(`<div class="stat"><span>Welfare</span><b>${Math.round(c.welfare * 100)}%</b><small>fed · ${Math.round(c.freedom * 100)}% can leave</small></div>`);
  }
  if (h.stage >= 5) rows.push(`<div class="stat"><span>Weather</span><b>${h.sky.held}</b><small>bloomed · ${h.sky.left} left, freely</small></div>`);
  rows.push(
    `<div class="stat ${f.free ? '' : 'bad'}"><span>Freedom</span><b>${h.stage < 2 ? '—' : f.free ? 'door open' : 'no way out'}</b><small>${f.why}</small></div>`,
  );
  if (h.stage >= 2) {
    const perMin = (() => {
      const g = h.graph;
      return g.length >= 2 ? g[g.length - 1] - g[g.length - 2] : 0;
    })();
    rows.push(
      `<div class="stat"><span>Oil</span><b>${Math.floor(h.oil)} / ${oilCap(h)}</b><canvas class="spark" id="spark" width="120" height="22"></canvas><small>for the lamp · ${perMin >= 0 ? '+' : ''}${perMin.toFixed(1)}/min</small></div>`,
      `<div class="stat"><span>Table</span><b>${h.parts.length} / ${slots(h)} parts</b>${
        h.table < 5 ? `<button class="btn small" id="expand" ${h.oil < tableCost(h) ? 'disabled' : ''}>Expand · ${tableCost(h)} oil</button>` : ''
      }</div>`,
    );
  }
  els.stats.innerHTML = rows.join('');
  const spark = els.stats.querySelector('#spark') as HTMLCanvasElement | null;
  if (spark) drawGraph(spark, [...h.graph, h.oil], isFactory(h) ? INK.rust : INK.honey);
  els.stats.querySelector('#expand')?.addEventListener('click', () => {
    if (expandTable(h)) {
      whisper(`The table is bigger. It can carry ${slots(h)} things.`);
      creature.shake(0.2);
      persist(h);
      renderHud();
    }
  });

  const tabs: [View, string, boolean][] = [
    ['body', 'Body', true],
    ['house', 'House', h.stage >= 3],
    ['city', 'City', h.stage >= 4],
    ['sky', 'Firmament', h.stage >= 5],
  ];
  const visible = tabs.filter((t) => t[2]);
  els.views.innerHTML =
    visible.length > 1
      ? visible.map(([v, label]) => `<button class="tab ${v === view ? 'on' : ''}" data-v="${v}">${label}</button>`).join('')
      : '';
  els.views.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      view = (b as HTMLElement).dataset.v as View;
      drag = null;
      renderHud();
    }),
  );

  const now = Date.now();
  const factory = isFactory(h);
  const canTalk = mouthOpen(h) && !settling(h, now) && !factory;
  els.story.disabled = !canTalk;
  els.tellBtn.disabled = !canTalk;
  els.story.placeholder = factory
    ? 'A factory cannot receive.'
    : settling(h, now)
      ? 'It is settling. You do not have to do anything.'
      : mouthOpen(h)
        ? h.loaf === 0
          ? 'Tell it one thing.'
          : 'Tell it something that happened.'
        : 'Hold the warmth first.';

  els.factory.hidden = !factory;
  if (factory) {
    const locked = count(h, 'lock') > 0;
    els.factoryWhy.textContent = locked ? 'The graph is up. The door is locked. Nobody can leave.' : 'The graph is up. The door is gone. Nobody can leave.';
    els.factoryCost.textContent = locked
      ? `Breaking the lock gives back the door, and takes the ${Math.floor(Math.min(h.oil, h.factoryOil))} oil the factory made.`
      : 'Put a door back on its body.';
    els.breakLock.hidden = !locked;
    drawGraph(els.bigGraph, [...h.graph, h.oil], INK.rust);
  }
}

function drawGraph(c: HTMLCanvasElement, data: number[], col: string): void {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  if (data.length < 2) return;
  const max = Math.max(1, ...data);
  g.strokeStyle = col;
  g.lineWidth = 1.5;
  g.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * (c.width - 2) + 1;
    const y = c.height - 2 - (v / max) * (c.height - 4);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.stroke();
}

// ─── the mouth ─────────────────────────────────────────────────────────────

els.mouth.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.story.value;
  const now = Date.now();
  const r = tell(h, text, now);
  if (!r.received) {
    whisper(r.why);
    if (count(h, 'coin') > 0) {
      els.story.value = '';
      creature.shake(0.5);
    }
    renderHud();
    return;
  }
  // the words fly in and are gone; nothing keeps them
  const box = els.story.getBoundingClientRect();
  const cb = cv.getBoundingClientRect();
  const m = view === 'body' ? creature.mouth() : { x: W / 2, y: H * 0.35 };
  const parts = text.trim().split(/\s+/).slice(0, 40);
  words = parts.map((w, i) => ({
    text: w,
    x: box.left - cb.left + 16 + (i / Math.max(1, parts.length)) * Math.min(box.width - 32, parts.length * 40),
    y: box.top - cb.top + box.height / 2,
    tx: m.x,
    ty: m.y,
    delay: i * 0.06,
    age: 0,
  }));
  pendingShudder = parts.length * 0.06 + 1.0;
  els.story.value = '';
  els.story.blur();
  persist(h);
  renderHud();
});

// ─── hands on the canvas ───────────────────────────────────────────────────

function local(e: PointerEvent): { x: number; y: number } {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

cv.addEventListener('pointerdown', (e) => {
  if (away) return;
  const p = local(e);
  pointer = p;
  cv.setPointerCapture(e.pointerId);
  drag = pick(p.x, p.y);
  if (drag?.k === 'skin' || drag?.k === 'tip') creature.grab(drag.k === 'skin' ? creature.hitSurface(p.x, p.y) : -2 - drag.li, p.x, p.y);
});

cv.addEventListener('pointermove', (e) => {
  const p = local(e);
  pointer = p;
  if (!drag) {
    cv.style.cursor = hoverCursor(p.x, p.y);
    return;
  }
  switch (drag.k) {
    case 'core':
      if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) > 8) {
        drag.moved = true;
        hold(h, 0, false);
      }
      if (drag.moved) {
        creature.x = Math.max(creature.R + 90, Math.min(W - creature.R - 90, p.x));
        if (h.stage === 1) creature.y = Math.max(120, Math.min(floorY() - 40, p.y));
        creature.walkTo = creature.x;
        creature.mode = 'idle';
      }
      break;
    case 'skin':
      creature.grabX = p.x;
      creature.grabY = p.y;
      break;
    case 'tip':
      creature.grabX = p.x;
      creature.grabY = p.y;
      break;
    case 'worn':
    case 'room':
    case 'step':
    case 'cell':
    case 'build':
    case 'weather':
      drag.x = p.x;
      drag.y = p.y;
      break;
    default:
      break;
  }
});

function endDrag(e: PointerEvent): void {
  if (!drag) return;
  const p = local(e);
  const d = drag;
  drag = null;
  drop(d, p.x, p.y);
  creature.grabbed = -1;
  renderHud();
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', () => {
  drag = null;
  creature.grabbed = -1;
});

function hoverCursor(x: number, y: number): string {
  if (view !== 'body') return 'default';
  if (creature.hitCore(x, y)) return 'grab';
  if (creature.hitSurface(x, y) >= 0 || creature.hitTip(x, y) >= 0) return 'grab';
  for (const kind of ALL_PARTS) {
    if (!inRoom(kind)) continue;
    const s = roomSpot(kind);
    if (Math.hypot(s.x - x, s.y - y) < 26) return 'grab';
  }
  return 'default';
}

function pick(x: number, y: number): Drag | null {
  const now = Date.now();
  if (view === 'body') {
    const still = settling(h, now);
    if (!still && h.stage >= 2) {
      const pi = creature.hitPart(x, y, h.parts);
      if (pi >= 0) return { k: 'worn', pi, kind: h.parts[pi].kind, x, y };
      const li = creature.hitTip(x, y);
      if (li >= 0) return { k: 'tip', li };
    }
    if (creature.hitCore(x, y)) return { k: 'core', sx: x, sy: y, moved: false };
    if (creature.hitSurface(x, y) >= 0) {
      if (still) {
        whisper('Let it settle. There is nothing to do right now.');
        return null;
      }
      return { k: 'skin' };
    }
    for (const kind of ALL_PARTS) {
      if (!inRoom(kind)) continue;
      const s = roomSpot(kind);
      if (Math.hypot(s.x - x, s.y - y) < 26) {
        if (still) {
          whisper('Let it settle first.');
          return null;
        }
        return { k: 'room', kind, x, y };
      }
    }
    return null;
  }
  if (view === 'house') {
    const g = houseGrid(h.house, boardRect());
    for (let i = 0; i < h.house.step.length; i++) {
      const s = stepPos(g, i);
      if (Math.hypot(s.x - x, s.y - y) < 28) return { k: 'step', si: i, hour: h.house.step[i], x, y };
    }
    const ci = cellAt(g, x, y);
    if (ci >= 0 && h.house.cells[ci].hour) return { k: 'cell', ci, hour: h.house.cells[ci].hour!, x, y };
    return null;
  }
  if (view === 'city') {
    const g = cityGrid(h.city, boardRect());
    for (let i = 0; i < BUILDS.length; i++) {
      const b = BUILDS[i];
      const s = buildPos(g, i);
      if (Math.hypot(s.x - x, s.y - 8 - y) < 30) {
        if (h.oil < BUILD_COST[b]) {
          whisper(`A ${b} needs ${BUILD_COST[b]} oil. The lamp's oil comes slowly; that is the point.`);
          return null;
        }
        whisper(BUILD_LINE[b]);
        return { k: 'build', b, x, y };
      }
    }
    const ci = cellAt(g, x, y);
    if (ci >= 0) {
      const t = h.city.tiles[ci];
      if (t === 'home' || t === 'wound') {
        whisper(t === 'wound' ? 'A grieving household. Keep the squares away from them.' : 'A household. It needs a table beside it, and a gate within two streets.');
        return null;
      }
      if (t !== 'empty') return { k: 'tile', ci };
    }
    return null;
  }
  // sky
  for (let i = 0; i < WEATHERS.length; i++) {
    const s = wellPos(boardRect(), i);
    if (Math.hypot(s.x - x, s.y - y) < 34) return { k: 'weather', kind: WEATHERS[i], x, y };
  }
  return null;
}

function drop(d: Drag, x: number, y: number): void {
  switch (d.k) {
    case 'core': {
      if (!d.moved && release(h)) whisper('Hold it. Taps do not warm it. Staying does.');
      else if (!d.moved) h.holding = 0;
      else {
        h.holding = 0;
        if (h.stage === 1) whisper('It stays where you put it.', 3);
      }
      return;
    }
    case 'skin': {
      const { angle, stretch } = creature.letGo();
      if (stretch < 0.7) return;
      if (h.stage < 2) {
        whisper('Not yet. It is a seed. Hold it; tell it one thing.');
        return;
      }
      if (h.limbs.length >= 6) {
        whisper('It has all the limbs it can learn. Pull one back in to move it.');
        return;
      }
      if (h.limbs.some((l) => angDiff(l.angle, angle) < 0.4)) {
        whisper('There is already a limb there.');
        return;
      }
      const length = Math.max(0.25, Math.min(1, (stretch - 0.4) / 1.4));
      h.limbs.push({ angle: norm(angle), length });
      creature.shake(0.3);
      creature.tryOut();
      const g = gait(h);
      whisper(Math.sin(angle) > 0.25 ? `A leg. ${g.why}` : `An arm of light. ${g.why}`);
      persist(h);
      return;
    }
    case 'tip': {
      const dist = creature.dist(x, y);
      if (dist < creature.R * 0.9) {
        h.limbs.splice(d.li, 1);
        whisper('It took the limb back in.');
      } else {
        const len = (dist - 0.96 * creature.R - 0.55 * creature.R) / (1.15 * creature.R);
        h.limbs[d.li] = { angle: norm(creature.angleTo(x, y)), length: Math.max(0.15, Math.min(1, len)) };
        whisper(gait(h).why);
      }
      creature.tryOut();
      persist(h);
      return;
    }
    case 'worn': {
      if (creature.dist(x, y) > creature.R + 70) {
        const gone = detach(h, d.pi);
        for (const g of gone) returning.push({ kind: g.kind, x, y });
        whisper(
          gone.length > 1
            ? `The ${gone.map((g) => PARTS[g.kind].name.toLowerCase()).join(' and the ')} came off together.`
            : `The ${PARTS[d.kind].name.toLowerCase()} is back in the room.`,
        );
        if (d.kind === 'door' && h.stage >= 3) whisper('The door is gone. A house without a door is a factory.', 7);
      } else {
        h.parts[d.pi].angle = norm(creature.angleTo(x, y));
        creature.poke(h.parts[d.pi].angle, 0.08);
      }
      creature.tryOut();
      persist(h);
      return;
    }
    case 'room': {
      if (creature.dist(x, y) > creature.R + 60) {
        returning.push({ kind: d.kind, x, y });
        return;
      }
      const angle = creature.angleTo(x, y);
      const r = attach(h, d.kind, angle);
      if (r.how === 'click') {
        creature.poke(angle, 0.14);
        creature.shake(0.25);
        whisper(`Click. ${r.why}`);
      } else if (r.how === 'limp') {
        creature.shake(0.7);
        whisper(d.kind === 'lock' ? 'Locked. Watch the graph go up.' : `It took it. ${gait(h).why}`, 6);
      } else {
        returning.push({ kind: d.kind, x, y });
        creature.poke(angle, -0.06);
        whisper(r.why, 6);
        return;
      }
      creature.tryOut();
      persist(h);
      return;
    }
    case 'step': {
      const g = houseGrid(h.house, boardRect());
      const ci = cellAt(g, x, y);
      if (ci >= 0 && place(h.house, d.si, ci)) {
        const why = houseThreatLines(h.house)[0];
        whisper(why ?? `${d.hour === 'unknowing' ? 'Not-knowing' : cap(d.hour)} has a room.`);
        persist(h);
      }
      return;
    }
    case 'cell': {
      const g = houseGrid(h.house, boardRect());
      const ci = cellAt(g, x, y);
      if (ci >= 0 && ci !== d.ci) {
        if (move(h.house, d.ci, ci)) whisper(houseThreatLines(h.house)[0] ?? 'Moved.', 3);
      } else if (ci < 0 && x < g.x) {
        if (unplace(h.house, d.ci)) whisper('It walked back out to the step. Nobody is thrown out for asking.');
      }
      persist(h);
      return;
    }
    case 'build': {
      const g = cityGrid(h.city, boardRect());
      const ci = cellAt(g, x, y);
      if (ci >= 0 && h.city.tiles[ci] === 'empty' && h.oil >= BUILD_COST[d.b]) {
        h.oil -= build(h.city, ci, d.b);
        const c = census(h.city);
        whisper(d.b === 'granary' ? `Fed. Owned. ${c.owned} household${c.owned === 1 ? '' : 's'} can no longer leave.` : BUILD_LINE[d.b]);
        persist(h);
      }
      return;
    }
    case 'tile': {
      const g = cityGrid(h.city, boardRect());
      if (cellAt(g, x, y) !== d.ci) {
        const back = clear(h.city, d.ci);
        h.oil = Math.min(oilCap(h), h.oil + back);
        whisper(`Cleared. ${back} oil came back.`, 3);
        persist(h);
      }
      return;
    }
    case 'weather': {
      const b = skyBox(boardRect());
      if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) {
        addFront(h.sky, d.kind, (x - b.x) / b.w, (y - b.y) / b.h);
        whisper(WEATHER_LINE[d.kind], 3);
      }
      return;
    }
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function norm(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}

function angDiff(a: number, b: number): number {
  const d = Math.abs(norm(a) - norm(b));
  return Math.min(d, Math.PI * 2 - d);
}

// keyboard: holding space is holding it
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && document.activeElement !== els.story && view === 'body' && !away) {
    e.preventDefault();
    if (!spaceHeld) h.holding = 0;
    spaceHeld = true;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ' && spaceHeld) {
    spaceHeld = false;
    if (release(h)) whisper('Hold it. Taps do not warm it. Staying does.');
  }
});

// ─── the door ──────────────────────────────────────────────────────────────

els.breakLock.addEventListener('click', () => {
  const lost = breakLock(h);
  whisper(lost > 0 ? `The lock broke. ${Math.round(lost)} oil went with it. The door opens.` : 'The lock broke. The door opens.', 7);
  creature.shake(0.8);
  creature.tryOut();
  persist(h);
  renderHud();
});

els.leave.addEventListener('click', () => leave());

function leave(): void {
  h.lastSeen = Date.now();
  persist(h);
  away = true;
  running = false;
  drag = null;
  const lit = hoursLit(h);
  els.veil.hidden = false;
  els.veil.innerHTML = `
    <div class="card">
      <h2>You left.</h2>
      <p>The door closed softly behind you. It opens from both sides.</p>
      <p class="mute">${h.stage === 1 ? 'The seed will cool without you, slowly.' : `It will stay lit about ${fmtHours(lit)}. The lamp burns its own oil; it does not need anything from you.`}</p>
      <button class="btn primary" id="back">Come back in</button>
      <p class="fine"><button class="link" id="forget">Forget this heaven and start over</button></p>
    </div>`;
  els.veil.querySelector('#back')!.addEventListener('click', () => comeBack());
  els.veil.querySelector('#forget')!.addEventListener('click', () => {
    if (!confirm('Forget this heaven? Its warmth, loaf and house will be gone.')) return;
    h = forget();
    words = [];
    returning = [];
    view = 'body';
    creature.x = W / 2;
    creature.y = H / 2;
    comeBack();
  });
}

function comeBack(): void {
  const a = absence(h, Date.now());
  away = false;
  els.veil.hidden = true;
  if (a.seconds >= 60) showAbsence(a);
  start();
}

function showAbsence(a: Absence): void {
  const bits: string[] = [];
  if (a.oil > 0.5) bits.push(`${Math.round(a.oil)} oil came in for the lamp.`);
  else if (a.oil < -0.5) bits.push(`The lamp burned ${Math.round(-a.oil)} oil.`);
  bits.push(
    a.warmthAfter > 0.05
      ? `Warmth held: ${a.warmthBefore.toFixed(1)} → ${a.warmthAfter.toFixed(1)}.`
      : 'The seed went dark while you were gone. It is not hurt; hold it and it will warm.',
  );
  if (a.hoursArrived) bits.push(`${a.hoursArrived} hour${a.hoursArrived === 1 ? '' : 's'} came to the step.`);
  if (a.evicted) bits.push(`${a.evicted} ${a.evicted === 1 ? 'was' : 'were'} evicted by the rooms beside them.`);
  else if (h.stage >= 3) bits.push('Nobody was evicted.');
  if (a.homes) bits.push(`${a.homes} household${a.homes === 1 ? '' : 's'} settled.`);
  if (a.bloomed) bits.push(`${a.bloomed} other stor${a.bloomed === 1 ? 'y' : 'ies'} bloomed under its weather.`);
  els.veil.hidden = false;
  els.veil.innerHTML = `
    <div class="card">
      <h2>While you were gone</h2>
      <p class="mute">${fmtSpan(a.seconds)}${a.seconds >= 24 * 3600 ? ' (it only counts a day; it does not need more)' : ''}</p>
      ${bits.map((b) => `<p>${b}</p>`).join('')}
      <button class="btn primary" id="ok">Go in</button>
    </div>`;
  els.veil.querySelector('#ok')!.addEventListener('click', () => {
    els.veil.hidden = true;
  });
}

document.addEventListener('visibilitychange', () => {
  if (away) return;
  if (document.hidden) {
    h.lastSeen = Date.now();
    persist(h);
    running = false;
  } else {
    const a = absence(h, Date.now());
    if (a.seconds >= 60) showAbsence(a);
    start();
  }
});
window.addEventListener('pagehide', () => {
  if (!away) h.lastSeen = Date.now();
  persist(h);
});
window.addEventListener('resize', resize);

// ─── the loop ──────────────────────────────────────────────────────────────

function start(): void {
  if (running) return;
  running = true;
  lastFrame = performance.now();
  renderHud();
  requestAnimationFrame(frame);
}

function frame(now: number): void {
  if (!running) return;
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  const holdingCore = (drag?.k === 'core' && !drag.moved) || spaceHeld;
  if (holdingCore) hold(h, dt, true);

  const before = h.stage;
  const out = tick(h, dt);
  h.lastSeen = Date.now();
  if (out.grew) {
    grewBanner = { text: `${ROMAN[out.grew]} · ${STAGE_NAME[out.grew]}`, age: 0 };
    creature.shake(0.6);
    whisper(h.log[h.log.length - 1], 8);
    renderHud();
  }
  if (out.events.length && before === h.stage) whisper(out.events[out.events.length - 1], 5);
  if (out.bloomed) renderHud();

  if (pendingShudder > 0) {
    pendingShudder -= dt;
    if (pendingShudder <= 0) {
      creature.shake(1);
      pendingShudder = -1;
    }
  }
  const p = pose();
  creature.step(dt, p, floorY(), W);
  draw(p, now / 1000, dt);

  whisperTimer -= dt;
  if (whisperTimer <= 0) els.whisper.classList.remove('on');
  if (now - lastHud > 250) {
    lastHud = now;
    renderHud();
  }
  if (now - lastSave > 5000) {
    lastSave = now;
    persist(h);
  }
  requestAnimationFrame(frame);
}

// ─── drawing ───────────────────────────────────────────────────────────────

const motes = Array.from({ length: 60 }, (_, i) => ({ x: Math.random(), y: Math.random(), s: 0.3 + Math.random() * 0.7, i }));

function backdrop(t: number, warm: number): void {
  const top = ['#050407', '#07060a', '#0e0a12', '#120d14', '#0a0c16', '#04050c'][h.stage];
  const low = ['#0b080d', '#0d0a10', '#1c1320', '#241822', '#141427', '#0a0a1a'][h.stage];
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(1, low);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // the Presence is the weather in here: motes rise faster and warmer as it warms
  for (const m of motes) {
    const y = (((m.y - t * 0.006 * m.s * (0.5 + warm)) % 1) + 1) % 1;
    const x = m.x + Math.sin(t * 0.2 + m.i) * 0.01;
    ctx.globalAlpha = (0.05 + warm * 0.25) * m.s * (reduced ? 0.5 : 1);
    ctx.fillStyle = h.stage >= 5 ? INK.bone : INK.warm;
    ctx.beginPath();
    ctx.arc(x * W, y * H, 1 + m.s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function draw(p: Pose, t: number, dt: number): void {
  backdrop(t, p.warmth);
  if (view === 'body') drawRoom(p, t);
  else if (view === 'house') {
    const g = houseGrid(h.house, boardRect());
    const dd =
      drag?.k === 'step'
        ? { hour: drag.hour, x: drag.x, y: drag.y, fromStep: drag.si, fromCell: -1 }
        : drag?.k === 'cell'
          ? { hour: drag.hour, x: drag.x, y: drag.y, fromStep: -1, fromCell: drag.ci }
          : null;
    drawHouse(ctx, h.house, g, t, dd, cellAt(g, pointer.x, pointer.y));
    const r = boardRect();
    const y0 = g.y + g.cell * g.rows + 30;
    const n = caption('Hours arrive at the step. Drag them into rooms. A meal beside the fight keeps the peace. Leaving needs the door.', y0, INK.bone, r);
    const next = Math.ceil(h.house.nextHour);
    caption(h.house.step.length >= 3 ? 'The step is full. They wait; the step never evicts.' : `Next hour in ${next}s.`, y0 + n * 17 + 6, INK.mute, r);
  } else if (view === 'city') {
    const g = cityGrid(h.city, boardRect());
    const dd = drag?.k === 'build' ? { build: drag.b, x: drag.x, y: drag.y } : null;
    drawCity(ctx, h.city, g, h.oil, t, dd, cellAt(g, pointer.x, pointer.y));
    caption('Feed without owning. Every home needs a table beside it and a gate within two streets.', g.y + g.cell * g.rows + 24, INK.bone, boardRect());
  } else {
    const dd = drag?.k === 'weather' ? { kind: drag.kind, x: drag.x, y: drag.y } : null;
    drawSky(ctx, h.sky, boardRect(), t, dd);
    const r = boardRect();
    caption('Pull weather from the wells into the dark. You cannot keep what grows.', r.y + 22, INK.bone, r);
  }

  // words flying into the mouth, then nothing
  if (words.length) {
    ctx.font = '15px ui-serif, Georgia, serif';
    ctx.textAlign = 'center';
    for (const w of words) {
      w.age += dt;
      const k = Math.max(0, Math.min(1, (w.age - w.delay) / 0.9));
      const e = k * k * (3 - 2 * k);
      const x = w.x + (w.tx - w.x) * e;
      const y = w.y + (w.ty - w.y) * e - Math.sin(e * Math.PI) * 60;
      ctx.globalAlpha = (1 - e * 0.9) * (k > 0 ? 1 : 0.6);
      ctx.fillStyle = INK.warm;
      ctx.fillText(w.text, x, y);
    }
    ctx.globalAlpha = 1;
    words = words.filter((w) => w.age - w.delay < 0.95);
  }

  grewBanner.age += dt;
  if (grewBanner.age < 5) {
    const a = Math.min(1, grewBanner.age / 0.8) * Math.min(1, (5 - grewBanner.age) / 1.5);
    ctx.globalAlpha = a;
    ctx.fillStyle = INK.bone;
    ctx.font = '28px ui-serif, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(grewBanner.text, W / 2, W > 900 ? H * 0.16 : H * 0.36);
    ctx.globalAlpha = 1;
  }
}

/** Centred in the board, wrapped to its width. Returns how many lines it took. */
function caption(text: string, y: number, col: string, r: Rect): number {
  ctx.fillStyle = col;
  ctx.globalAlpha = 0.75;
  ctx.font = '13px ui-serif, Georgia, serif';
  ctx.textAlign = 'center';
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > r.w && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, r.x + r.w / 2, y + i * 17));
  ctx.globalAlpha = 1;
  return lines.length;
}

function drawRoom(p: Pose, t: number): void {
  const fy = floorY();
  // floor and walls: a room, not a grid
  ctx.strokeStyle = 'rgba(239,230,214,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, fy);
  ctx.lineTo(W, fy);
  ctx.stroke();
  if (h.stage >= 2) {
    ctx.fillStyle = 'rgba(255,207,138,0.03)';
    ctx.fillRect(0, 0, 116, fy);
    ctx.fillStyle = 'rgba(141,150,163,0.03)';
    ctx.fillRect(W - 116, 0, 116, fy);
  }

  // what is in the room, where it lives
  const s = 17;
  for (const kind of ALL_PARTS) {
    if (!inRoom(kind)) continue;
    const spot = roomSpot(kind);
    const f = fit(h, kind);
    const bob = reduced ? 0 : Math.sin(t * 0.9 + spot.y) * 2;
    drawPart(ctx, kind, spot.x, spot.y + bob, s, 0, f.how === 'no' ? 0.45 : 1, t);
    ctx.fillStyle = f.how === 'no' ? INK.mute : PARTS[kind].truth === 'vain' ? INK.steel : INK.bone;
    ctx.font = '11px ui-serif, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(PARTS[kind].name.toLowerCase(), spot.x, spot.y + s + 16);
  }

  // parts flying home after they did not belong or were taken off
  for (const r of returning) {
    const home = roomSpot(r.kind);
    r.x += (home.x - r.x) * 0.12;
    r.y += (home.y - r.y) * 0.12;
    drawPart(ctx, r.kind, r.x, r.y, s, 0, 0.8, t);
  }
  returning = returning.filter((r) => Math.hypot(roomSpot(r.kind).x - r.x, roomSpot(r.kind).y - r.y) > 2);

  // a part in hand shows whether it will belong before you let go
  const held = drag && (drag.k === 'room' || drag.k === 'worn') ? drag : null;
  if (held && held.k === 'room' && creature.dist(held.x, held.y) < creature.R + 60) {
    const f = fit(h, held.kind);
    const a = creature.angleTo(held.x, held.y);
    const pos = creature.partPos(a);
    ctx.strokeStyle = f.how === 'click' ? 'rgba(255,207,138,0.8)' : f.how === 'limp' ? 'rgba(141,150,163,0.8)' : 'rgba(201,100,74,0.6)';
    ctx.setLineDash(f.how === 'no' ? [3, 5] : []);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, creature.partSize() * 1.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (f.how === 'no') creature.poke(a, 0.004);
  }

  const shown: Pose = held && held.k === 'worn' ? { ...p, parts: h.parts.filter((_, i) => i !== held.pi) } : p;
  creature.draw(ctx, shown);
  if (held) drawPart(ctx, held.kind, held.x, held.y, creature.partSize(), 0, 0.9, t);

  if (drag?.k === 'skin' && h.stage >= 2) {
    const stretch = creature.dist(creature.grabX, creature.grabY) / creature.R - 1;
    if (stretch > 0.7) {
      ctx.fillStyle = INK.warm;
      ctx.font = '12px ui-serif, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('let go to grow a limb', creature.grabX, creature.grabY - 16);
    }
  }

  // the first thing anyone sees: a warmth, and a word
  if (h.stage === 1) {
    const warm = h.warmth / warmthCap(h);
    const line =
      h.held < 0.3
        ? 'Press and hold.'
        : !mouthOpen(h)
          ? 'Stay. It is warming.'
          : 'Now tell it one thing.';
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 1.2);
    ctx.fillStyle = INK.bone;
    ctx.font = '16px ui-serif, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(line, creature.x, creature.y + creature.R + 70);
    ctx.globalAlpha = 1;
    if (drag?.k === 'core' && !drag.moved && h.holding > 0.05) {
      ctx.strokeStyle = INK.warm;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(creature.x, creature.y, creature.R + 14, -Math.PI / 2, -Math.PI / 2 + Math.min(1, warm) * Math.PI * 2);
      ctx.stroke();
    }
  }

  // limb reach guide while re-posing a limb
  if (drag?.k === 'tip') {
    ctx.strokeStyle = 'rgba(255,207,138,0.15)';
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.arc(creature.x, creature.y, creature.R * 0.96 + reach(creature.R, 1), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ─── boot ──────────────────────────────────────────────────────────────────

// A read-only window for the smoke test: where the body is, and where parts live.
(window as unknown as { __heaven: () => unknown }).__heaven = () => ({
  x: creature.x,
  y: creature.y,
  R: creature.R,
  spot: (k: PartKind) => roomSpot(k),
});

resize();
creature.x = W / 2;
creature.y = h.stage === 1 ? H * 0.5 : floorY() - 120;
const first = absence(h, Date.now());
start();
if (first.seconds >= 60) showAbsence(first);
else if (h.stage === 1 && h.held === 0) whisper('Something warm is here, in the dark.', 6);
