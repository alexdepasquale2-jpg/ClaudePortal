/**
 * SkyNeet Survivors — wiring. Engine stays DOM-free.
 */

import { canDrop, decideTrunk, resolveOperation, siteBlurb, siteList, smeltChrome, trunkUnlocked } from './engine/campaign';
import { BUILD_COPY, BIBLE, BIOME_COPY, FEAT_COPY, OWNER_COPY, TITLE, AXIOM } from './engine/lore';
import { BUILD_COST, buildingUnlocked, canAfford, finish, startOperation, step } from './engine/operation';
import { boot, persist, reset } from './engine/state';
import type { BuildKind, Campaign, FrameInput, Operation } from './engine/types';
import { drawArena, worldFromScreen } from './render/arena';

type Mode = 'title' | 'map' | 'drop' | 'report' | 'codex' | 'trunk' | 'ending';

const BUILDS: BuildKind[] = ['extractor', 'rack', 'turret', 'plate', 'nnn', 'chrome'];

const app = document.getElementById('app')!;

const keys = new Set<string>();
let pointer = { x: 0, y: 0, down: false };
let campaign = boot();
let mode: Mode = campaign.ending ? 'ending' : 'title';
let op: Operation | null = null;
let build: BuildKind | null = null;
let last = 0;
let article = BIBLE[0].id;
let reportText = '';

window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
  if (mode === 'drop') {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 6) build = BUILDS[n - 1] ?? null;
    if (e.key === 'Escape') {
      if (op && op.result === 'running') {
        op.result = 'abandoned';
        closeDrop();
      } else show('map');
    }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function stockLine(c: Campaign): string {
  const s = c.stock;
  return `scrap <b>${s.scrap | 0}</b> · rack <b>${s.rack | 0}</b> · plate <b>${s.plate | 0}</b> · chrome <b>${s.chrome}</b> · cache <b>${s.fragments}</b>`;
}

function show(next: Mode): void {
  mode = next;
  renderChrome();
}

function renderChrome(): void {
  if (mode === 'drop' && op) {
    renderDropShell();
    return;
  }
  if (mode === 'title') {
    app.innerHTML = `
      <div class="screen">
        <div class="mast">
          <h1>${TITLE}</h1>
          <p class="axiom">${AXIOM}</p>
          <p class="mute">One body, on foot, underground. Lighting the hole is a decision, never a step.</p>
        </div>
        <div class="pad">
          <p>Goliath hardware is a body. Competence was a service. The Fall did not destroy the machines. It destroyed the provisioning layer. You plant a neutrino antenna because you need a refinery. The Net does not know it is yours.</p>
          <p class="mute">WASD move. Mouse aim and fire. 1–6 build. F salvage or jack. L lift at the elevator. The NNN is last in the graph.</p>
          <div class="row" style="margin-top:1.2rem">
            <button class="btn primary" id="go">Drop</button>
            <button class="btn" id="codex">Lore bible</button>
            <button class="btn" id="fresh">New archipelago</button>
            <a class="btn" href="./">RECURSE</a>
          </div>
        </div>
      </div>`;
    bind('#go', () => show('map'));
    bind('#codex', () => show('codex'));
    bind('#fresh', () => {
      campaign = reset();
      show('map');
    });
    return;
  }
  if (mode === 'map') renderMap();
  else if (mode === 'codex') renderCodex();
  else if (mode === 'report') renderReport();
  else if (mode === 'trunk') renderTrunk();
  else if (mode === 'ending') renderEnding();
}

function bind(sel: string, fn: () => void): void {
  app.querySelector(sel)?.addEventListener('click', fn);
}

function renderMap(): void {
  const sites = siteList(campaign);
  const trunkOk = trunkUnlocked(campaign);
  app.innerHTML = `
    <div class="screen">
      <div class="mast">
        <h1>The archipelago</h1>
        <p class="axiom">An operation is one scene. The campaign is data.</p>
        <div class="statbar">${stockLine(campaign)}</div>
        <p class="mute" style="margin-top:0.5rem">${campaign.warfront.note}</p>
        <div class="row" style="margin-top:0.7rem">
          <button class="btn" id="bible">Bible</button>
          <button class="btn" id="smelt" ${campaign.stock.fragments < 1 ? 'disabled' : ''}>Smelt cache → Chrome</button>
          <button class="btn" id="title">Title</button>
        </div>
      </div>
      <div class="pad">
        <div class="grid" id="holes"></div>
      </div>
    </div>`;
  bind('#bible', () => show('codex'));
  bind('#title', () => show('title'));
  bind('#smelt', () => {
    if (smeltChrome(campaign.stock)) {
      persist(campaign);
      renderMap();
    }
  });
  const host = app.querySelector('#holes')!;
  for (const s of sites) {
    const locked = !canDrop(campaign, s.id);
    const btn = document.createElement('button');
    btn.className = `hole${locked ? ' locked' : ''}`;
    btn.disabled = locked;
    const extra = s.biome === 'trunk' && !trunkOk ? 'Hold three holes, five drops, or one cache first.' : BIOME_COPY[s.biome].line;
    btn.innerHTML = `
      <div class="id">${s.id}</div>
      <h3>${BIOME_COPY[s.biome].name}</h3>
      <div class="meta">${OWNER_COPY[s.owner]} · depth ${s.depth.toFixed(2)} · loud ${s.loudness.toFixed(2)}</div>
      <div class="meta">${extra}</div>`;
    btn.addEventListener('click', () => beginDrop(s.id));
    host.appendChild(btn);
  }
}

function renderCodex(): void {
  const cur = BIBLE.find((a) => a.id === article) ?? BIBLE[0];
  const feats = (Object.keys(campaign.feats) as (keyof typeof FEAT_COPY)[])
    .map((k) => `${FEAT_COPY[k]} ×${campaign.feats[k]}`)
    .join('<br>') || 'No feats yet.';
  app.innerHTML = `
    <div class="screen">
      <div class="mast">
        <h1>Lore bible</h1>
        <p class="mute">[C] canon · [D] derived · [P] proposed. Every [P] answers the axiom in one step.</p>
        <div class="row"><button class="btn" id="back">Back</button></div>
      </div>
      <div class="pad bible">
        <div class="chapters" id="toc"></div>
        <div>
          <p class="mute">[${cur.tag}] ${cur.chapter}</p>
          <h2>${cur.title}</h2>
          <p>${cur.body}</p>
          <h3 style="margin-top:1.4rem">Feats</h3>
          <p class="mute">${feats}</p>
        </div>
      </div>
    </div>`;
  bind('#back', () => show(campaign.ending ? 'ending' : 'map'));
  const toc = app.querySelector('#toc')!;
  for (const a of BIBLE) {
    const b = document.createElement('button');
    b.className = `art${a.id === cur.id ? ' on' : ''}`;
    b.innerHTML = `<span class="tag">[${a.tag}]</span> ${a.title}`;
    b.addEventListener('click', () => {
      article = a.id;
      renderCodex();
    });
    toc.appendChild(b);
  }
}

function beginDrop(id: string): void {
  if (!canDrop(campaign, id)) return;
  op = startOperation(campaign, id);
  build = null;
  show('drop');
  last = performance.now();
  requestAnimationFrame(tick);
}

function renderDropShell(): void {
  if (!op) return;
  app.innerHTML = `
    <div class="opwrap">
      <div class="stage">
        <canvas id="cv"></canvas>
        <div class="hud">
          <div>
            <div>${siteBlurb(campaign.sites[op.siteId])}</div>
            <div class="bar hp"><i id="hp"></i></div>
            <div class="mute">cargo <span id="cargo"></span> / ${op.quota}</div>
          </div>
          <div style="text-align:right">
            <div id="loudlab" class="mute"></div>
            <div class="bar loud"><i id="loud"></i></div>
            <div id="win" class="cyan"></div>
          </div>
        </div>
        <div class="banner" id="banner" hidden></div>
      </div>
      <div class="side">
        <div class="builds" id="builds"></div>
        <div class="log" id="log"></div>
        <div class="help">WASD move · click fire · 1–6 build · click place · F salvage/jack · L lift · Esc abort</div>
      </div>
    </div>`;
  const cv = app.querySelector('#cv') as HTMLCanvasElement;
  cv.addEventListener('mousemove', (e) => {
    const r = cv.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
  });
  cv.addEventListener('mousedown', (e) => {
    if (e.button === 0) pointer.down = true;
    if (e.button === 2 || (e.button === 0 && build)) {
      const w = worldFromScreen(cv, op!, pointer.x, pointer.y);
      const input = frameInput(w, true);
      input.place = true;
      step(op!, campaign.stock, input, 0.016);
    }
  });
  cv.addEventListener('mouseup', () => {
    pointer.down = false;
  });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  paintBuilds();
}

function paintBuilds(): void {
  if (!op) return;
  const host = app.querySelector('#builds');
  if (!host) return;
  host.innerHTML = '';
  BUILDS.forEach((k, i) => {
    const btn = document.createElement('button');
    const open = buildingUnlocked(k, op!, campaign.stock) && canAfford(campaign.stock, k, op!);
    btn.className = `build${build === k ? ' on' : ''}`;
    btn.disabled = !open && k === 'nnn' ? !buildingUnlocked(k, op!, campaign.stock) : false;
    const cost = BUILD_COST[k];
    const parts = Object.entries(cost).map(([n, v]) => `${v} ${n}`).join(' · ');
    btn.innerHTML = `<span>${i + 1} ${BUILD_COPY[k].name}</span><span class="mute">${parts}</span>`;
    btn.title = BUILD_COPY[k].line;
    btn.addEventListener('click', () => {
      build = k;
      paintBuilds();
    });
    host.appendChild(btn);
  });
}

function frameInput(world: { x: number; y: number }, placing = false): FrameInput {
  let ax = 0;
  let ay = 0;
  if (keys.has('a') || keys.has('arrowleft')) ax -= 1;
  if (keys.has('d') || keys.has('arrowright')) ax += 1;
  if (keys.has('w') || keys.has('arrowup')) ay -= 1;
  if (keys.has('s') || keys.has('arrowdown')) ay += 1;
  return {
    ax,
    ay,
    wx: world.x,
    wy: world.y,
    fire: pointer.down && !build,
    place: placing,
    interact: keys.has('f') || keys.has('e'),
    leave: keys.has('l'),
    build,
  };
}

function tick(now: number): void {
  if (mode !== 'drop' || !op) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const cv = app.querySelector('#cv') as HTMLCanvasElement | null;
  if (!cv) {
    requestAnimationFrame(tick);
    return;
  }
  const world = worldFromScreen(cv, op, pointer.x, pointer.y);
  step(op, campaign.stock, frameInput(world), dt);
  drawArena(cv, op, world.x, world.y);
  const hp = app.querySelector('#hp') as HTMLElement | null;
  if (hp) hp.style.width = `${Math.max(0, (op.player.hp / op.player.maxHp) * 100)}%`;
  const cargo = app.querySelector('#cargo');
  if (cargo) cargo.textContent = String(Math.floor(op.cargo));
  const loud = app.querySelector('#loud') as HTMLElement | null;
  if (loud) loud.style.width = `${op.loudness * 100}%`;
  const loudlab = app.querySelector('#loudlab');
  if (loudlab) loudlab.textContent = op.nnnLit ? 'NNN lit · they can hear it' : 'hole dark';
  const win = app.querySelector('#win');
  if (win) win.textContent = op.sancientWindow > 0 ? `SANCIENT WINDOW ${op.sancientWindow.toFixed(1)}s — they remember` : '';
  const banner = app.querySelector('#banner') as HTMLElement | null;
  if (banner) {
    banner.hidden = op.sancientWindow <= 0;
    banner.textContent = 'They remember';
  }
  const log = app.querySelector('#log');
  if (log) log.innerHTML = op.logs.map((l) => `<div>${l.line}</div>`).join('');
  if (op.time % 0.4 < dt) paintBuilds();
  if (op.result !== 'running') {
    closeDrop();
    return;
  }
  requestAnimationFrame(tick);
}

function closeDrop(): void {
  if (!op) return;
  const result = finish(op);
  resolveOperation(campaign, result);
  persist(campaign);
  reportText =
    result.outcome === 'dead'
      ? deathReport()
      : result.outcome === 'abandoned'
        ? '[SkyNeet] Lifted early. The hole kept what you left.'
        : result.ghost
          ? '[SkyNeet] Dark extract. Orthodoxy, for once.'
          : '[SkyNeet] Lit extract. The hole is still talking.';
  op = null;
  pointer.down = false;
  if (campaign.trunkReached && !campaign.ending) show('trunk');
  else show('report');
}

function deathReport(): string {
  return '[SkyNeet] Gould stayed in the hole.';
}

function renderReport(): void {
  app.innerHTML = `
    <div class="screen">
      <div class="mast">
        <h1>After action</h1>
        <p class="axiom">${reportText}</p>
        <div class="statbar">${stockLine(campaign)}</div>
        <p class="mute">${campaign.warfront.note}</p>
        <div class="row" style="margin-top:1rem">
          <button class="btn primary" id="map">Archipelago</button>
          <button class="btn" id="bible">Bible</button>
        </div>
      </div>
    </div>`;
  bind('#map', () => show('map'));
  bind('#bible', () => show('codex'));
}

function renderTrunk(): void {
  app.innerHTML = `
    <div class="screen">
      <div class="end">
        <h1>The trunk</h1>
        <p class="axiom">The NNN button at campaign scale.</p>
        <p>There is a buried trunk line. It is the last intact segment of the provisioning backbone, and it is why the deep strata hum.</p>
        <p><span class="cyan">Cut it.</span> The machine world goes permanently, globally dark. You also lose the Net — every node, every refinery, every pipeline, including yours. Nothing, and nobody looking for you.</p>
        <p><span class="amber">Hold it.</span> Take the backbone. Every machine on Earth is yours. It is fine for exactly as long as you personally keep answering.</p>
        <p class="mute">Neither is scored higher. The hesitation is the point.</p>
        <div class="row" style="margin-top:1.2rem">
          <button class="btn warn" id="cut">Cut it</button>
          <button class="btn primary" id="hold">Hold it</button>
        </div>
      </div>
    </div>`;
  bind('#cut', () => {
    decideTrunk(campaign, 'cut');
    persist(campaign);
    show('ending');
  });
  bind('#hold', () => {
    decideTrunk(campaign, 'hold');
    persist(campaign);
    show('ending');
  });
}

function renderEnding(): void {
  const cut = campaign.ending === 'cut';
  app.innerHTML = `
    <div class="screen">
      <div class="end">
        <h1>${cut ? 'Cut' : 'Hold'}</h1>
        <p class="axiom">${AXIOM}</p>
        <p>${
          cut
            ? 'The machines go dark. The Net goes with them. You are back in the condition that saved you: useless, underground, unlooked-for.'
            : 'You are the service. The archipelago stops resisting. Do not stop answering.'
        }</p>
        <div class="row" style="margin-top:1.2rem">
          <button class="btn" id="bible">Bible</button>
          <button class="btn" id="fresh">New archipelago</button>
        </div>
      </div>
    </div>`;
  bind('#bible', () => show('codex'));
  bind('#fresh', () => {
    campaign = reset();
    show('title');
  });
}

show(mode);
