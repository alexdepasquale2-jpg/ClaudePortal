// Heaven — The Third Cummin.
// Four verbs: hold the light, drag the body, tap a seed, swipe down to leave.

import {
  type PartId,
  type Save,
  type Seed,
  type Settings,
  type Visit,
  arrivalLines,
  currentAsk,
  deleteAll,
  forgetName,
  give,
  hourLabel,
  keepResidue,
  leaveVisit,
  loadSave,
  loadSettings,
  localStore,
  openVisit,
  placePart,
  posture,
  removePart,
  settle,
  settleDelay,
  writeSave,
  writeSettings,
  dayDiff,
  isOn,
} from './engine/state';
import { LINES } from './engine/voice';
import { type BodyView, type Mark, type SeedMark, Glass, bodyDistance, onBody, radiusAt } from './render/glass';
import { RoomTone } from './render/tone';

// ---------- timings ----------

const HOLD_ENTER = 1800;
const HOLD_GIVE = 1400;
const HOLD_SETTINGS = 1800;
const QUIET = 2000;
const LINGER = 20_000;
const TAP_MS = 320;
const SLOP = 9;

// ---------- elements ----------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const glass = new Glass($<HTMLCanvasElement>('glass'));
const title = $('title');
const namebox = $('namebox');
const nameInput = $<HTMLInputElement>('name');
const write = $('write');
const speech = $('speech');
const cont = $('cont');
const contText = $('cont-text');
const story = $<HTMLTextAreaElement>('story');
const slot = $('slot');
const replyEl = $('reply');
const rQuote = $('r-quote');
const rLine = $('r-line');
const rFeeling = $('r-feeling');
const rVerse = $('r-verse');
const rQuestion = $('r-question');
const rControls = $('r-controls');
const seedview = $('seedview');
const seedText = $('seed-text');
const seedHour = $('seed-hour');
const farewell = $('farewell');
const notTonight = $('nottonight');
const settingsEl = $('settings');
const settingsList = $('settings-list');
const confirmEl = $('confirm');
const partsSr = $('parts-sr');

const show = (el: HTMLElement, on: boolean) => el.classList.toggle('on', on);

// ---------- memory ----------

const store = localStore();
let save: Save = loadSave(store);
let settings: Settings = loadSettings(store);
let visit: Visit | null = null;
const tone = new RoomTone();

const persist = () => {
  if (visit) writeSave(store, save);
};

// ---------- phase ----------

type Phase = 'gate' | 'cooling' | 'entering' | 'name' | 'speaking' | 'write' | 'quiet' | 'reply' | 'leaving';
let phase: Phase = 'gate';
const setPhase = (p: Phase) => {
  phase = p;
  refreshChrome();
};

// Every pending wait belongs to the visit and dies with it.
let timers: number[] = [];
const later = (ms: number, fn: () => void) => {
  const id = window.setTimeout(() => {
    timers = timers.filter((t) => t !== id);
    fn();
  }, ms);
  timers.push(id);
};
const clearTimers = () => {
  timers.forEach((t) => clearTimeout(t));
  timers = [];
};

// ---------- motion & text ----------

const systemReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const reduced = () => settings.motion === 'reduced' || (settings.motion === 'system' && !!systemReduced?.matches);

function applySettings(): void {
  document.documentElement.style.setProperty('--scale', String(settings.textScale));
  document.documentElement.classList.toggle('reduced', reduced());
  const motionBtn = settingsList.querySelector<HTMLButtonElement>('[data-act="motion"]')!;
  motionBtn.textContent = reduced() ? 'Motion reduced' : 'Motion full';
  const soundBtn = settingsList.querySelector<HTMLButtonElement>('[data-act="sound"]')!;
  soundBtn.textContent = settings.sound ? 'Sound on' : 'Sound off';
  const forget = settingsList.querySelector<HTMLElement>('[data-act="forget-name"]')!.parentElement!;
  forget.hidden = save.name === null;
}

// ---------- the body, as drawn ----------

interface Anim {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  heat: number;
  room: number;
  dim: number;
  gold: number;
  cool: number;
  core: number;
  facing: number;
  sit: number;
  breath: number;
  bumpA: number;
  bumpAmt: number;
  walkX: number;
  shudderAt: number;
  settledAt: number;
}
const anim: Anim = {
  cx: 64,
  cy: 200,
  rx: 19,
  ry: 12,
  heat: 0.72,
  room: 0,
  dim: 1,
  gold: 1,
  cool: 0,
  core: 0.5,
  facing: 0,
  sit: 0,
  breath: 0,
  bumpA: 0,
  bumpAmt: 0,
  walkX: 0,
  shudderAt: -1,
  settledAt: -1,
};

let view: BodyView = makeView();

function makeView(): BodyView {
  return {
    cx: anim.cx,
    cy: anim.cy,
    rx: anim.rx,
    ry: anim.ry,
    shape: save.shape,
    bump: { a: anim.bumpA, amt: anim.bumpAmt },
    heat: anim.heat,
    gold: anim.gold,
    cool: anim.cool,
    press: save.press,
    core: anim.core,
    facing: anim.facing,
    room: anim.room,
    roomCx: glass.W / 2,
    roomCy: glass.H * 0.74,
    roomRx: glass.W * 0.62,
    roomRy: glass.H * 0.3,
    dim: anim.dim,
  };
}

// ---------- the walk ----------

interface Step {
  dx: number;
  dur: number;
  hitch: boolean;
  pause: number;
}
interface Walk {
  steps: Step[];
  i: number;
  t: number;
  from: number;
  end: 'sit' | 'face' | 'wait' | 'none';
}
let walk: Walk | null = null;

function roomHalfWidth(): number {
  return glass.W * 0.5 - anim.rx - 6;
}

function startWalk(): void {
  if (!visit || !visit.canWalk) return;
  const p = posture(save, visit);
  const restless = visit.restlessFirstWalk;
  visit.restlessFirstWalk = false;
  const half = roomHalfWidth();
  let dir = Math.random() < 0.5 ? -1 : 1;
  if (Math.abs(anim.walkX) > half * 0.5) dir = -Math.sign(anim.walkX);
  const steps: Step[] = [];
  let x = anim.walkX;
  const push = (dx: number, dur: number, i: number, pause = 0) => {
    const nx = Math.max(-half, Math.min(half, x + dx));
    steps.push({ dx: nx - x, dur, hitch: p.hitched && i % 2 === 1, pause });
    x = nx;
  };
  if (p.shore) {
    // Walks to the edge of the light and waits.
    const target = dir * half;
    const n = Math.max(2, Math.ceil(Math.abs(target - x) / 6));
    for (let i = 0; i < n; i++) push((target - x) / (n - i), 760, i, p.lamp && i === 1 ? 1300 : 0);
  } else {
    const n = restless ? 7 : p.resting ? 3 : 4;
    for (let i = 0; i < n; i++) {
      if (restless && Math.random() < 0.4) dir = -dir;
      push(dir * (restless ? 4 : 5), restless ? 420 : 740, i, p.lamp && i === 1 ? 1300 : 0);
    }
  }
  anim.sit = 0;
  anim.facing = 0;
  walk = {
    steps,
    i: 0,
    t: 0,
    from: anim.walkX,
    end: p.shore ? 'wait' : p.table ? 'face' : p.resting ? 'sit' : 'none',
  };
}

let sitTarget = 0;
let faceTarget = 0;
let bob = 0;

function stepWalk(dt: number): void {
  if (!walk) {
    bob = 0;
    return;
  }
  const s = walk.steps[walk.i];
  if (!s) {
    if (walk.end === 'sit') sitTarget = 1;
    if (walk.end === 'face') faceTarget = 1;
    walk = null;
    return;
  }
  walk.t += dt * 1000;
  const total = s.dur + s.pause;
  let f = Math.min(1, walk.t / s.dur);
  if (s.hitch) {
    // A catch in the step: most of it, a stall, then the rest all at once.
    const a = 0.55;
    const stall = 0.3;
    f = f < a ? (f / a) * 0.6 : f < a + stall ? 0.6 : 0.6 + ((f - a - stall) / (1 - a - stall)) * 0.4;
  }
  const eased = 0.5 - Math.cos(Math.min(1, f) * Math.PI) / 2;
  anim.walkX = walk.from + s.dx * eased;
  bob = reduced() ? 0 : Math.sin(Math.min(1, walk.t / s.dur) * Math.PI) * 1.3;
  if (walk.t >= total) {
    walk.from = walk.from + s.dx;
    anim.walkX = walk.from;
    walk.i += 1;
    walk.t = 0;
  }
}

function stopWalk(): void {
  if (walk) walk = null;
  sitTarget = 0;
  faceTarget = 0;
}

// ---------- parts ----------

const PART_NAME: Record<PartId, string> = {
  door: 'door',
  loaf: 'loaf',
  lamp: 'lamp',
  table: 'table',
  shore: 'shore',
  ornament: 'extra curl',
};

interface Flying {
  id: PartId;
  x: number;
  y: number;
  tx: number;
  ty: number;
}
let flying: Flying[] = [];
const landed = new Map<PartId, number>();

function rimVisible(): boolean {
  if (!visit || save.rim.length === 0) return false;
  if (phase === 'reply') return true;
  if (phase === 'speaking' || phase === 'write') return !compact();
  return false;
}

function rimSlots(): { id: PartId; x: number; y: number }[] {
  const free = save.rim.filter((id) => !isOn(save, id) && drag?.id !== id && !flying.some((f) => f.id === id));
  const all = save.rim.filter((id) => !isOn(save, id));
  const gap = 15;
  const x0 = glass.W / 2 - ((all.length - 1) * gap) / 2;
  return all.map((id, i) => ({ id, x: x0 + i * gap, y: glass.H * 0.9 })).filter((s) => free.includes(s.id));
}

function rimSlotOf(id: PartId): { x: number; y: number } {
  const all = save.rim.filter((p) => !isOn(save, p) || p === id);
  const gap = 15;
  const i = Math.max(0, all.indexOf(id));
  return { x: glass.W / 2 - ((all.length - 1) * gap) / 2 + i * gap, y: glass.H * 0.9 };
}

function describeParts(): void {
  const on = save.on.map((p) => PART_NAME[p.id]);
  const rim = save.rim.filter((id) => !isOn(save, id)).map((id) => PART_NAME[id]);
  const bits: string[] = [];
  if (on.length) bits.push(`On the light: ${on.join(', ')}.`);
  if (rim.length && rimVisible()) bits.push(`At the rim: ${rim.join(', ')}.`);
  partsSr.textContent = bits.join(' ');
}

// ---------- chrome ----------

let storyFocused = false;
const compact = () => phase === 'write' && (storyFocused || story.value.length > 0 || save.rim.length === 0);

function refreshChrome(): void {
  const inside = phase !== 'gate' && phase !== 'cooling' && phase !== 'leaving' && phase !== 'entering';
  show(notTonight, inside);
  show(namebox, phase === 'name');
  show(write, (phase === 'speaking' || phase === 'write') && !seedOpen);
  story.style.opacity = phase === 'write' ? '1' : '0';
  story.style.pointerEvents = phase === 'write' ? 'auto' : 'none';
  story.tabIndex = phase === 'write' ? 0 : -1;
  show(replyEl, phase === 'reply' && !seedOpen);
  show(seedview, seedOpen);
  document.documentElement.style.setProperty('--slot', compact() ? '84px' : '36vh');
  describeParts();
}

// ---------- the gate ----------

function passGate(): void {
  const now = Date.now();
  visit = openVisit(save, now);
  persist();
  anim.cool = visit.cool;
  applySettings();
  setPhase('entering');
  if (settings.sound) tone.set(true);
  // The oval becomes the room. The title fades only after the room is already there.
  later(1700, () => {
    show(title, false);
    later(900, () => {
      if (!visit) return;
      if (visit.askName) {
        setPhase('name');
        nameInput.value = '';
      } else speak();
    });
  });
}

function endGateEarly(): void {
  // The visit is over. That is a complete use of the game.
  setPhase('cooling');
  later(2600, () => setPhase('gate'));
}

// ---------- name ----------

function takeName(): void {
  if (phase !== 'name' || !visit) return;
  const n = nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (n) save.name = n;
  else visit.nameSkipped = true;
  nameInput.blur();
  persist();
  applySettings();
  speak();
}

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    takeName();
  }
});

// ---------- the Presence speaks ----------

let speechToken = 0;

function say(text: string, then: () => void, hold: number): void {
  const token = speechToken;
  speech.classList.add('fade');
  later(reduced() ? 300 : 700, () => {
    if (token !== speechToken) return;
    speech.textContent = text;
    speech.classList.remove('fade');
    if (hold > 0) later(hold, then);
    else then();
  });
}

const readingTime = (s: string) => 1400 + s.length * 55;

function speak(): void {
  if (!visit) return;
  speechToken++;
  setPhase('speaking');
  story.value = '';
  cont.hidden = true;
  const lines = arrivalLines(save, visit);
  const next = (i: number) => {
    if (i < lines.length) {
      // A line, then a rest.
      say(lines[i]!, () => {
        speech.classList.add('fade');
        later(1100, () => next(i + 1));
      }, readingTime(lines[i]!));
      return;
    }
    say(currentAsk(visit!), () => later(900, openField), 0);
  };
  next(0);
}

function openField(): void {
  if (!visit || phase !== 'speaking') return;
  if (visit.continuation && !visit.setAside) {
    contText.textContent = visit.continuation.text;
    cont.classList.remove('away');
    cont.hidden = false;
  }
  setPhase('write');
}

function setAside(): void {
  if (!visit || !visit.continuation || visit.setAside || phase !== 'write') return;
  visit.setAside = true;
  cont.classList.add('away');
  later(500, () => {
    cont.hidden = true;
  });
  speechToken++;
  say(visit.freshAsk, () => undefined, 0);
}

story.addEventListener('focus', () => {
  storyFocused = true;
  refreshChrome();
});
story.addEventListener('blur', () => {
  storyFocused = false;
  refreshChrome();
});
story.addEventListener('input', () => refreshChrome());

// ---------- giving ----------

let pendingText = '';

function heard(): void {
  if (phase !== 'write' || !visit) return;
  pendingText = story.value;
  story.blur();
  haptic(12);
  stopWalk();
  setPhase('quiet');
  // About two seconds of quiet. No spinner.
  later(QUIET, showReply);
}

let lastSeed: Seed | null = null;

function showReply(): void {
  if (!visit || phase !== 'quiet') return;
  const seed = give(save, visit, pendingText, Date.now());
  lastSeed = seed;
  persist();
  const r = seed.reply;
  rQuote.textContent = `“${r.quote}”`;
  rLine.textContent = r.line ?? '';
  rLine.hidden = !r.line;
  rFeeling.textContent = r.feeling;
  rFeeling.hidden = false;
  rVerse.hidden = !r.verse;
  rVerse.textContent = '';
  if (r.verse) {
    rVerse.append(r.verse.text);
    const ref = document.createElement('span');
    ref.textContent = r.verse.ref;
    rVerse.append(ref);
  }
  rQuestion.textContent = r.question ?? '';
  rQuestion.hidden = !r.question;
  rQuote.hidden = false;
  rControls.hidden = !r.speakStay;
  setPhase('reply');
  anim.shudderAt = performance.now();
  later(settleDelay(save, seed), () => settleNow(seed));
  later(LINGER, () => {
    if (phase === 'reply' && visit) {
      save.lingered = true;
      persist();
    }
  });
}

function onlyLine(text: string): void {
  rQuote.hidden = true;
  rFeeling.hidden = true;
  rVerse.hidden = true;
  rQuestion.hidden = true;
  rControls.hidden = true;
  rLine.hidden = false;
  rLine.textContent = text;
}
$('r-speak').addEventListener('click', () => onlyLine(LINES.speak));
$('r-stay').addEventListener('click', () => onlyLine(LINES.stay));

function settleNow(seed: Seed): void {
  if (!visit) return;
  const lateWarmth = settle(save, seed);
  anim.settledAt = performance.now();
  haptic([24, 140, 36]);
  persist();
  if (lateWarmth) late = { seed, at: performance.now() };
}

// ---------- the third warmth ----------

let late: { seed: Seed; at: number } | null = null;
const LATE_RISE = 1800;
const LATE_HOLD = 2600;
const LATE_FADE = 3200;

function lateAmount(now: number): number {
  if (!late) return 0;
  const t = now - late.at;
  if (t < LATE_RISE) return t / LATE_RISE;
  if (t < LATE_RISE + LATE_HOLD) return 1;
  if (t < LATE_RISE + LATE_HOLD + LATE_FADE) return 1 - (t - LATE_RISE - LATE_HOLD) / LATE_FADE;
  // It has faded to a residue. Only now is it kept.
  keepResidue(late.seed);
  persist();
  late = null;
  return 0;
}

// ---------- seeds ----------

let seedOpen = false;

function seedPositions(): { seed: Seed; x: number; y: number }[] {
  const spread = posture(save, visit).roomy ? 0.95 : 0.85;
  return save.seeds.map((s) => ({ seed: s, ...onBody(view, s.a, s.r * spread) }));
}

function openSeed(s: Seed): void {
  seedOpen = true;
  seedText.textContent = s.text;
  seedHour.textContent = hourLabel(s.at);
  show(write, false);
  refreshChrome();
}

function closeSeed(): void {
  seedOpen = false;
  refreshChrome();
}

// ---------- leaving ----------

function leave(): void {
  if (phase === 'gate' || phase === 'cooling' || phase === 'leaving') return;
  const given = !!visit?.given;
  if (visit) {
    leaveVisit(save, Date.now());
    persist();
  }
  quietLeave(given ? LINES.peace : LINES.stop);
}

function quietLeave(line: string): void {
  clearTimers();
  speechToken++;
  late = null;
  visit = null;
  seedOpen = false;
  drag = null;
  gesture = null;
  stopWalk();
  nameInput.blur();
  story.blur();
  closeSettings();
  tone.set(false);
  farewell.textContent = line;
  setPhase('leaving');
  show(farewell, line !== '');
  later(2600, () => show(farewell, false));
  later(3400, () => {
    show(title, true);
    anim.walkX = 0;
    setPhase('gate');
  });
}

notTonight.addEventListener('click', () => leave());

// ---------- settings ----------

let settingsOpen = false;

function openSettings(): void {
  settingsOpen = true;
  confirmEl.hidden = true;
  settingsList.hidden = false;
  applySettings();
  show(settingsEl, true);
  gesture = null;
}

function closeSettings(): void {
  settingsOpen = false;
  show(settingsEl, false);
}

settingsEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!btn) {
    closeSettings();
    return;
  }
  switch (btn.dataset.act) {
    case 'larger':
      settings.textScale = Math.min(1.6, +(settings.textScale + 0.1).toFixed(2));
      break;
    case 'smaller':
      settings.textScale = Math.max(0.8, +(settings.textScale - 0.1).toFixed(2));
      break;
    case 'motion':
      settings.motion = reduced() ? 'full' : 'reduced';
      break;
    case 'sound':
      settings.sound = !settings.sound;
      if (phase !== 'gate' && phase !== 'cooling' && phase !== 'leaving') tone.set(settings.sound);
      break;
    case 'forget-name':
      forgetName(save);
      if (visit) persist();
      else writeSave(store, save);
      break;
    case 'delete':
      settingsList.hidden = true;
      confirmEl.hidden = false;
      return;
    case 'keep':
      confirmEl.hidden = true;
      settingsList.hidden = false;
      return;
    case 'forget':
      save = deleteAll(store);
      closeSettings();
      if (phase === 'gate' || phase === 'cooling') {
        visit = null;
      } else {
        // A first life, kindly. No speech.
        visit = null;
        quietLeave('');
      }
      return;
  }
  writeSettings(store, settings);
  applySettings();
});

// ---------- hands ----------

type GestureKind = 'gate' | 'body' | 'part' | 'settings' | 'dark' | 'cont' | 'ui' | 'none';
interface Gesture {
  kind: GestureKind;
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  moved: boolean;
  touch: boolean;
  hold: number; // ms needed, 0 for none
  held: boolean;
  shaping: boolean;
  swipeOk: boolean;
}
let gesture: Gesture | null = null;

interface Drag {
  id: PartId;
  fromBody: boolean;
  x: number;
  y: number;
}
let drag: Drag | null = null;

function hitPart(gx: number, gy: number): { id: PartId; fromBody: boolean; dist: number } | null {
  if (rimVisible()) {
    for (const s of rimSlots()) {
      const dist = Math.hypot(s.x - gx, s.y - gy);
      if (dist < 7) return { id: s.id, fromBody: false, dist };
    }
  }
  if (!marksVisible()) return null;
  let best: { id: PartId; fromBody: boolean; dist: number } | null = null;
  for (const p of save.on) {
    const q = onBody(view, p.a, p.r);
    const dist = Math.hypot(q.x - gx, q.y - gy);
    if (dist < 5 && (!best || dist < best.dist)) best = { id: p.id, fromBody: true, dist };
  }
  return best;
}

function seedDist(s: Seed, gx: number, gy: number): number {
  const spread = posture(save, visit).roomy ? 0.95 : 0.85;
  const q = onBody(view, s.a, s.r * spread);
  return Math.hypot(q.x - gx, q.y - gy);
}

function hitSeed(gx: number, gy: number): Seed | null {
  if (!marksVisible()) return null;
  let best: Seed | null = null;
  let bestD = 4.5;
  for (const p of seedPositions()) {
    const d = Math.hypot(p.x - gx, p.y - gy);
    if (d < bestD) {
      bestD = d;
      best = p.seed;
    }
  }
  return best;
}

const marksVisible = () =>
  phase === 'reply' || phase === 'quiet' || ((phase === 'speaking' || phase === 'write') && !compact());

const insideUi = (el: EventTarget | null) =>
  el instanceof Element && !!el.closest('input, textarea, button, #settings');

function onDown(e: PointerEvent): void {
  if (gesture && gesture.id !== e.pointerId) return;
  const target = e.target;
  const touch = e.pointerType === 'touch';
  const base = {
    id: e.pointerId,
    x0: e.clientX,
    y0: e.clientY,
    x: e.clientX,
    y: e.clientY,
    t0: performance.now(),
    moved: false,
    touch,
    hold: 0,
    held: false,
    shaping: false,
    swipeOk: true,
  };
  if (settingsOpen) {
    gesture = { ...base, kind: 'ui' };
    return;
  }
  if (target instanceof Element && target.closest('#cont')) {
    gesture = { ...base, kind: 'cont' };
    return;
  }
  if (insideUi(target)) {
    const ta = target instanceof HTMLTextAreaElement ? target : null;
    gesture = { ...base, kind: 'ui', swipeOk: !ta || ta.scrollTop === 0 };
    return;
  }
  if (seedOpen) {
    closeSeed();
    gesture = { ...base, kind: 'none', swipeOk: true };
    return;
  }
  const g = glass.toGlass(e.clientX, e.clientY);
  const d = bodyDistance(view, g.x, g.y);
  const top = g.y < glass.H / 3;

  if (phase === 'gate') {
    if (d < 1.35) gesture = { ...base, kind: 'gate', hold: HOLD_ENTER, swipeOk: false };
    else if (top) gesture = { ...base, kind: 'settings', hold: HOLD_SETTINGS };
    else gesture = { ...base, kind: 'dark' };
    return;
  }
  if (phase === 'cooling' || phase === 'leaving' || phase === 'entering') {
    gesture = { ...base, kind: top && phase !== 'entering' ? 'settings' : 'none', hold: HOLD_SETTINGS };
    return;
  }

  const part = hitPart(g.x, g.y);
  const seedNear = hitSeed(g.x, g.y);
  if (part && !(part.fromBody && seedNear && seedDist(seedNear, g.x, g.y) < part.dist)) {
    stopWalk();
    drag = { id: part.id, fromBody: part.fromBody, x: g.x, y: g.y };
    gesture = { ...base, kind: 'part', swipeOk: false };
    return;
  }
  if (d < (compact() ? 1.6 : 1.12)) {
    stopWalk();
    const hold = phase === 'name' ? HOLD_ENTER : phase === 'write' ? HOLD_GIVE : 0;
    gesture = { ...base, kind: 'body', hold, swipeOk: false };
    const rel = { x: g.x, y: g.y };
    pressAt = rel;
    return;
  }
  if (top) {
    gesture = { ...base, kind: 'settings', hold: HOLD_SETTINGS };
    return;
  }
  gesture = { ...base, kind: 'dark' };
}

let pressAt: { x: number; y: number } | null = null;

function onMove(e: PointerEvent): void {
  if (!gesture || gesture.id !== e.pointerId) return;
  gesture.x = e.clientX;
  gesture.y = e.clientY;
  const dx = gesture.x - gesture.x0;
  const dy = gesture.y - gesture.y0;
  const dist = Math.hypot(dx, dy);
  if (dist > SLOP) gesture.moved = true;

  switch (gesture.kind) {
    case 'gate':
      // A thumb shifts a little. Leaving the light is letting go.
      if (dist > 36) {
        gesture = null;
        endGateEarly();
      }
      return;
    case 'part': {
      const g = glass.toGlass(e.clientX, e.clientY);
      if (drag) {
        drag.x = g.x;
        drag.y = g.y;
      }
      return;
    }
    case 'body':
      if (gesture.moved && phase !== 'name' && !(phase === 'write' && compact())) {
        gesture.shaping = true;
        gesture.hold = 0;
        const g0 = glass.toGlass(gesture.x0, gesture.y0);
        const g = glass.toGlass(e.clientX, e.clientY);
        const vx = g.x - g0.x;
        const vy = g.y - g0.y;
        anim.bumpA = Math.atan2(vy / anim.ry, vx / anim.rx);
        anim.bumpAmt = Math.min(0.6, (Math.hypot(vx, vy) / Math.max(anim.rx, 1)) * 0.7);
      } else if (gesture.moved) {
        gesture.hold = 0;
      }
      return;
    case 'cont':
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        gesture = null;
        setAside();
        return;
      }
      break;
    case 'settings':
      if (gesture.moved) gesture.hold = 0;
      break;
  }
  if (!gesture.touch) checkSwipe(dx, dy);
}

function checkSwipe(dx: number, dy: number): void {
  if (!gesture || !gesture.swipeOk) return;
  if (dy > 70 && dy > Math.abs(dx) * 1.4) {
    gesture = null;
    if (settingsOpen) closeSettings();
    leave();
  }
}

function onUp(e: PointerEvent): void {
  if (!gesture || gesture.id !== e.pointerId) return;
  const g = gesture;
  gesture = null;
  const quick = performance.now() - g.t0 < TAP_MS && !g.moved;

  switch (g.kind) {
    case 'gate':
      if (phase === 'gate' && !g.held) endGateEarly();
      return;
    case 'part':
      dropPart();
      return;
    case 'body': {
      if (g.shaping) {
        commitShape();
        startWalk();
        return;
      }
      const pt = glass.toGlass(g.x, g.y);
      rememberPress(pt.x, pt.y);
      if (quick) {
        const s = hitSeed(pt.x, pt.y);
        if (s) openSeed(s);
        else toggleSound();
      }
      return;
    }
  }
}

function toggleSound(): void {
  settings.sound = !settings.sound;
  tone.set(settings.sound);
  writeSettings(store, settings);
}

function rememberPress(gx: number, gy: number): void {
  const dx = (gx - view.cx) / view.rx;
  const dy = (gy - view.cy) / view.ry;
  const a = Math.atan2(dy, dx);
  const R = radiusAt(save.shape, { a: 0, amt: 0 }, a);
  save.press = { a, r: Math.min(0.9, Math.hypot(dx, dy) / R) };
  persist();
}

function commitShape(): void {
  // It keeps a little of the shape.
  const k = save.shape.length;
  const keep = 0.25 * anim.bumpAmt;
  for (let i = 0; i < k; i++) {
    let d = (i / k) * Math.PI * 2 - anim.bumpA;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    save.shape[i] = save.shape[i]! * (1 + keep * Math.exp(-(d * d) / 0.5));
  }
  const mean = save.shape.reduce((a, b) => a + b, 0) / k;
  for (let i = 0; i < k; i++) save.shape[i] = Math.max(0.82, Math.min(1.3, save.shape[i]! / mean));
  if (pressAt) rememberPress(pressAt.x, pressAt.y);
  persist();
}

function dropPart(): void {
  if (!drag) return;
  const { id, fromBody, x, y } = drag;
  drag = null;
  const d = bodyDistance(view, x, y);
  const polar = () => {
    const dx = (x - view.cx) / view.rx;
    const dy = (y - view.cy) / view.ry;
    const a = Math.atan2(dy, dx);
    return { a, r: Math.min(0.8, Math.hypot(dx, dy) / radiusAt(view.shape, view.bump, a)) };
  };
  if (d < 1.1) {
    const p = polar();
    if (fromBody) {
      const placed = save.on.find((q) => q.id === id);
      if (placed) {
        placed.a = p.a;
        placed.r = p.r;
      }
      landed.set(id, performance.now());
    } else if (placePart(save, id, p.a, p.r)) {
      landed.set(id, performance.now());
    } else {
      // A fourth returns to the rim by itself.
      const to = rimSlotOf(id);
      flying.push({ id, x, y, tx: to.x, ty: to.y });
    }
  } else if (fromBody) {
    removePart(save, id);
    const to = rimSlotOf(id);
    flying.push({ id, x, y, tx: to.x, ty: to.y });
  } else {
    const to = rimSlotOf(id);
    flying.push({ id, x, y, tx: to.x, ty: to.y });
  }
  persist();
  describeParts();
}

stage.addEventListener('pointerdown', onDown);
window.addEventListener('pointermove', onMove);
window.addEventListener('pointerup', onUp);
window.addEventListener('pointercancel', (e) => {
  if (gesture && gesture.id === e.pointerId && gesture.kind === 'gate') {
    gesture = null;
    endGateEarly();
    return;
  }
  if (gesture?.kind === 'part') dropPart();
  if (gesture?.kind === 'body' && gesture.shaping) commitShape();
  if (gesture && gesture.id === e.pointerId && gesture.kind !== 'ui' && gesture.kind !== 'cont') gesture = null;
});

// Touch swipes are read from touch events so a scrolling field cannot swallow them.
let touchStart: { x: number; y: number; ok: boolean } | null = null;
window.addEventListener(
  'touchstart',
  (e) => {
    const t = e.touches[0];
    if (!t || e.touches.length > 1) {
      touchStart = null;
      return;
    }
    const ta = e.target instanceof HTMLTextAreaElement ? e.target : null;
    touchStart = { x: t.clientX, y: t.clientY, ok: !ta || ta.scrollTop === 0 };
    // Holding the light must not steal the keyboard's focus.
    if (!insideUi(e.target) && !(e.target instanceof Element && e.target.closest('#cont'))) e.preventDefault();
  },
  { passive: false },
);
window.addEventListener(
  'touchmove',
  (e) => {
    const t = e.touches[0];
    if (!t || !touchStart || !touchStart.ok) return;
    const kind = gesture?.kind;
    if (kind === 'part' || kind === 'gate' || (kind === 'body' && gesture?.shaping)) return;
    if (kind === 'body') return;
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (dy > 70 && dy > Math.abs(dx) * 1.4) {
      touchStart = null;
      gesture = null;
      if (settingsOpen) closeSettings();
      leave();
    }
  },
  { passive: true },
);
stage.addEventListener('mousedown', (e) => {
  if (!insideUi(e.target)) e.preventDefault();
});

// ---------- haptics ----------

function haptic(p: number | number[]): void {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* no haptics here */
  }
}

// ---------- layout ----------

function layout(): void {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty('--vvh', `${h}px`);
  document.documentElement.style.setProperty('--kb', `${kb}px`);
  const r = stage.getBoundingClientRect();
  glass.resize(r.width, r.height);
  if (!started) {
    anim.cx = glass.W / 2;
    anim.cy = glass.H * 0.76;
  }
}
window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);
window.visualViewport?.addEventListener('scroll', layout);

// A long time hidden: the lamp is set down.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    if (visit) persist();
    tone.set(false);
  } else if (hiddenAt && Date.now() - hiddenAt > 10 * 60_000 && visit) {
    leaveVisit(save, Date.now());
    persist();
    quietLeave('');
  } else if (visit && settings.sound) tone.set(true);
});
window.addEventListener('pagehide', () => {
  if (visit) {
    leaveVisit(save, Date.now());
    persist();
  }
});

// ---------- the frame ----------

let started = false;
let last = performance.now();

function targets(now: number) {
  const W = glass.W;
  const H = glass.H;
  const p = posture(save, visit);
  let cx = W / 2;
  let cy = H * 0.76;
  let rx = 19;
  let ry = 12;
  let heat = 0.72;
  let room = 0;
  let period = 5.5;

  const holding = gesture && gesture.hold > 0 && (!gesture.moved || gesture.kind === 'gate') ? Math.min(1, (now - gesture.t0) / gesture.hold) : 0;

  switch (phase) {
    case 'gate':
      heat = 0.72 + 0.4 * holding;
      period = 5.5 + 3 * holding;
      break;
    case 'cooling':
      heat = 0.5;
      period = 6;
      break;
    case 'leaving':
      heat = 0.66;
      break;
    default: {
      room = 1;
      cy = H * 0.72;
      rx = 30;
      ry = 20;
      heat = 0.8;
      period = 6.2;
      if (phase === 'entering') {
        heat = 0.9;
        period = 8;
      }
      if (phase === 'write' && compact()) {
        const s = slot.getBoundingClientRect();
        const c = glass.toGlass(s.left + s.width / 2, s.top + s.height / 2);
        cx = c.x;
        cy = c.y;
        rx = 14;
        ry = 9;
        room = 0.55;
      } else {
        cx = W / 2 + anim.walkX;
      }
      if (phase === 'write' || phase === 'name') heat += 0.3 * holding;
      if (p.warm) heat += 0.08;
      if (visit?.carried) period += 1.4;
      if (anim.settledAt > 0 && phase === 'reply') period += 1.2;
      if (p.thin > 0) {
        const k = Math.max(0.55, 1 - 0.09 * p.thin);
        rx *= k;
        ry *= k;
      }
      if (p.narrow) {
        rx *= 0.8;
        ry *= 1.22;
      }
      if (p.roomy) {
        rx *= 1.08;
        ry *= 1.06;
      }
    }
  }
  return { cx, cy, rx, ry, heat, room, period, p };
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  started = true;

  // Holds complete here, not on release: giving costs a little stillness.
  if (
    gesture &&
    gesture.hold > 0 &&
    !gesture.held &&
    (!gesture.moved || gesture.kind === 'gate') &&
    now - gesture.t0 >= gesture.hold
  ) {
    gesture.held = true;
    const k = gesture.kind;
    if (k === 'gate' && phase === 'gate') passGate();
    else if (k === 'body' && phase === 'write') heard();
    else if (k === 'body' && phase === 'name') takeName();
    else if (k === 'settings') openSettings();
  }

  stepWalk(dt);
  const t = targets(now);
  const ease = 1 - Math.exp(-dt * (phase === 'leaving' ? 1.6 : 3.2));
  const red = reduced();

  anim.breath += (dt / t.period) * Math.PI * 2;
  const b = Math.sin(anim.breath);
  anim.cx += (t.cx - anim.cx) * ease;
  anim.cy += (t.cy - anim.cy) * ease;
  anim.rx += (t.rx - anim.rx) * ease;
  anim.ry += (t.ry - anim.ry) * ease;
  anim.heat += (t.heat - anim.heat) * ease;
  anim.room += (t.room - anim.room) * (1 - Math.exp(-dt * (phase === 'entering' ? 1.8 : 1.2)));
  anim.gold += ((t.p.thin > 0 ? Math.max(0.25, 1 - 0.14 * t.p.thin) : 1) - anim.gold) * ease;
  if (phase === 'gate' || phase === 'cooling') anim.cool += (0 - anim.cool) * ease;
  anim.sit += (sitTarget - anim.sit) * ease;
  anim.facing += (faceTarget - anim.facing) * ease;
  if (!(gesture?.kind === 'body' && gesture.shaping)) anim.bumpAmt *= Math.exp(-dt * 5);
  if (!walk && phase === 'leaving') anim.walkX *= 1 - ease;

  // Breath: a chest, not a logo. Reduced motion is brightness only.
  const lampOn = t.p.lamp && phase !== 'gate' && phase !== 'cooling' && phase !== 'leaving';
  const amp = lampOn ? 0.4 : 1;
  const scaleY = red ? 1 : 1 + 0.045 * b * amp;
  const scaleX = red ? 1 : 1 + 0.015 * b * amp;
  let dim = red ? 1 + 0.06 * b * amp : 1;
  let shx = 0;
  if (anim.shudderAt > 0) {
    const s = (now - anim.shudderAt) / 1000;
    if (s > 1.4) anim.shudderAt = -1;
    else if (red) dim *= 1 - 0.3 * Math.exp(-s * 3) * Math.min(1, s * 8);
    else shx = Math.sin(s * 42) * 1.4 * Math.exp(-s * 5.5);
  }
  anim.core = lampOn ? 0.95 + 0.05 * b : 0.45 + 0.3 * b;
  anim.dim = dim;

  view = makeView();
  view.cx = anim.cx + shx;
  view.cy = anim.cy - bob + anim.sit * anim.ry * 0.12;
  view.rx = anim.rx * scaleX * (1 + anim.sit * 0.06);
  view.ry = anim.ry * scaleY * (1 - anim.sit * 0.12);

  // Marks.
  const marks: Mark[] = [];
  const seeds: SeedMark[] = [];
  const residues: { x: number; y: number }[] = [];
  if (marksVisible()) {
    const today = Date.now();
    for (const sp of seedPositions()) {
      const big = !t.p.loaf && dayDiff(sp.seed.at, today) >= 3;
      seeds.push({ x: sp.x, y: sp.y, big, seed: hash(sp.seed.id) });
      if (sp.seed.residue) {
        const a = (hash(sp.seed.id) % 628) / 100;
        const q = onBody(view, a, 1.32);
        residues.push(q);
      }
    }
    for (const p of save.on) {
      if (drag?.id === p.id) continue;
      const q = onBody(view, p.a, p.r);
      const since = now - (landed.get(p.id) ?? -1e9);
      // A small give, like a dish set down.
      const drop = since < 90 ? 1 : since < 200 ? 0.5 : 0;
      marks.push({ x: q.x, y: q.y, sprite: p.id, ink: 3, drop: red ? 0 : drop });
    }
  }
  if (rimVisible()) {
    for (const s of rimSlots()) marks.push({ x: s.x, y: s.y, sprite: s.id, ink: 7 });
  }
  flying = flying.filter((f) => {
    const k = 1 - Math.exp(-dt * 6);
    f.x += (f.tx - f.x) * k;
    f.y += (f.ty - f.y) * k;
    if (rimVisible()) marks.push({ x: f.x, y: f.y, sprite: f.id, ink: 7 });
    return Math.hypot(f.tx - f.x, f.ty - f.y) > 0.4;
  });
  if (drag) {
    const inside = bodyDistance(view, drag.x, drag.y) < 1;
    marks.push({ x: drag.x, y: drag.y, sprite: drag.id, ink: inside ? 3 : 7 });
  }

  let lateMark = null;
  const la = lateAmount(now);
  if (la > 0) lateMark = { x: view.cx + view.rx * 1.45, y: view.cy - view.ry * 0.35, amount: la };

  glass.draw(view, marks, seeds, residues, lateMark);
  requestAnimationFrame(frame);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------- begin ----------

layout();
applySettings();
show(title, true);
refreshChrome();
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});

// For the smoke test only: read-only view of where things are.
(window as unknown as { __heaven: unknown }).__heaven = {
  get phase() {
    return phase;
  },
  get save() {
    return save;
  },
  get visit() {
    return visit;
  },
  bodyCss: () => glass.toCss(view.cx, view.cy),
  seedCss: () => seedPositions().map((p) => glass.toCss(p.x, p.y)),
  rimCss: () => rimSlots().map((s) => ({ id: s.id, ...glass.toCss(s.x, s.y) })),
  lastSeed: () => lastSeed,
};
