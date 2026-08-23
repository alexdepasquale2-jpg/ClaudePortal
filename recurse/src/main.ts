/**
 * main.ts — wiring.
 *
 * Owns the clock, the storage adapter, the sim worker and the DOM. Everything
 * about the game itself lives in src/engine; this file is allowed to know
 * about both sides, and nothing in src/engine is allowed to know about this
 * one.
 */

import { Engine, MAX_NODES, type OfflineSummary } from './engine/actions';
import { GOAL, doorReady, emptyRateMaps, genMaxBuy, buyEfficiency } from './engine/economy';
import { buildSimModel, toBuffers, type SimModel } from './engine/flat';
import { speciesTitle, type NodeData } from './engine/procgen';
import {
  SAVE_KEY,
  SIGIL_KEY,
  exportSave,
  hydrate,
  importSave,
  newGame,
  openStorage,
  randomSeed,
  seedFromUrl,
  type GameState,
  type KVAdapter,
  type SigilCache,
} from './engine/state';
import { readableAccent } from './render/palette';
import { playRitual, prefersReducedMotion, blip, unlockAudio, haptic } from './render/ritual';
import { TreeView } from './render/tree-view';
import { NodePanel } from './render/ui/node-panel';
import { dur, fmt, pct } from './render/ui/format';
import { h } from './render/ui/modal';
import {
  openAchievements,
  openCodex,
  openExport,
  openFeed,
  openHelp,
  openPrestige,
  openSettings,
  openStats,
  openWelcomeBack,
  speciesThumb,
  type ScreenDeps,
} from './render/ui/screens';
import type { RatesMsg, SimRequest } from './workers/sim.worker';

/** Simulation step. Small enough that integration error stays invisible. */
const TICK = 0.1;
/** Never simulate more than this many steps in one animation frame. */
const MAX_CATCHUP_STEPS = 12;
/** Autosave cadence. */
const SAVE_EVERY_MS = 10_000;
/**
 * Node count past which rate computation moves to the worker.
 *
 * Measured in tests/perf.spec.ts: the object walk costs ~0.44ms per 1,000
 * nodes on a desktop, so 10,000 nodes is ~4.4ms a tick — fine here, but a
 * low-end phone runs five to ten times slower, which would put a large tree
 * over budget at 10 ticks a second. Below this size the postMessage round trip
 * costs more than the pass it replaces.
 */
const WORKER_THRESHOLD = 1500;

class Game {
  engine!: Engine;
  kv!: KVAdapter;
  sigils: SigilCache = {};
  tree!: TreeView;
  panel!: NodePanel;
  worker: Worker | null = null;
  workerBusy = false;
  workerReady = false;
  model: SimModel | null = null;
  /** Flat generator index for (nodeIndex, genIndex), for count patches. */
  genIndexOf = new Map<string, number>();
  pendingCounts: [number, number][] = [];
  lastFrame = 0;
  accumulator = 0;
  lastSaveAt = 0;
  reduced = false;
  ritualBusy = false;
  els: Record<string, HTMLElement> = {};
  toastTimer = 0;
  fpsSamples: number[] = [];

  async boot(): Promise<void> {
    this.kv = await openStorage();
    const now = Date.now();

    let state: GameState | null = null;
    try {
      const raw = await this.kv.get(SAVE_KEY);
      if (raw) state = hydrate(JSON.parse(raw), now);
    } catch (err) {
      console.warn('save did not load, starting fresh', err);
    }
    try {
      const rawSigils = await this.kv.get(SIGIL_KEY);
      if (rawSigils) this.sigils = JSON.parse(rawSigils) as SigilCache;
    } catch {
      this.sigils = {};
    }

    const urlSeed = seedFromUrl(location.search);
    if (!state) {
      state = newGame(urlSeed ?? randomSeed(), now);
    }

    this.engine = new Engine(state);
    this.engine.events = {
      onDiscovery: (e) => this.onDiscovery(e.entry.key, e.node),
      onAchievement: (a) => this.toast(`Achievement: ${a.name}`),
      onStructure: () => this.onStructureChanged(),
    };
    this.engine.noteAllSpecies(now);
    this.engine.refreshRates();

    this.applyMotionPreference();
    this.buildDom();
    this.startWorkerIfNeeded();

    // Offline catch-up, before the first frame so the numbers on screen are
    // already correct when the summary is dismissed.
    const away = now - state.lastSaved;
    if (away > 60_000 && state.meta.stats.playtimeMs > 0) {
      const summary = this.engine.offline(away, now);
      if (summary.rootGain > 0 || summary.discoveries.length) this.showWelcomeBack(summary);
    }
    this.engine.checkAchievements(now);

    if (urlSeed !== null && urlSeed !== state.run.seed) this.offerSeed(urlSeed);

    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);

    addEventListener('beforeunload', () => void this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.save();
      else this.lastFrame = performance.now();
    });
    if (state.meta.stats.playtimeMs < 5000) openHelp();
  }

  // -------------------------------------------------------------------------
  // dom
  // -------------------------------------------------------------------------

  private buildDom(): void {
    const app = document.getElementById('app')!;
    app.textContent = '';

    const bar = h('header', { class: 'topbar' });
    const brand = h('div', { class: 'brand' }, h('span', { text: 'RECURSE' }));
    const readout = h('div', { class: 'readout' });
    this.els.output = h('strong', { class: 'big' });
    this.els.goal = h('span', { class: 'muted small' });
    this.els.mult = h('span', { class: 'chip' });
    this.els.nodes = h('span', { class: 'chip' });
    this.els.depth = h('span', { class: 'chip' });
    readout.append(
      h('div', { class: 'readout-main' }, this.els.output, this.els.goal),
      h('div', { class: 'chips' }, this.els.mult, this.els.nodes, this.els.depth),
    );

    this.els.goalBar = h('i');
    const goalBar = h('div', { class: 'goalbar' }, this.els.goalBar);

    const actions = h('div', { class: 'topactions' });
    const deps = this.screenDeps();
    const btn = (label: string, key: string, fn: () => void): HTMLElement => {
      const b = h('button', { class: 'btn btn-top', text: label, title: `${label} (${key})` });
      b.addEventListener('click', fn);
      return b;
    };
    this.els.resetBtn = btn('Reset', 'R', () => this.openPrestige());
    this.els.resetBtn.classList.add('btn-reset');
    actions.append(
      btn('Codex', 'X', () => openCodex(deps)),
      btn('Feed', 'F', () => openFeed(deps)),
      btn('Awards', 'A', () => openAchievements(deps)),
      btn('Stats', 'S', () => openStats(deps)),
      btn('Settings', ',', () => openSettings(deps)),
      btn('Help', '?', () => openHelp()),
      this.els.resetBtn,
    );

    bar.append(brand, readout, goalBar, actions);

    const treeHost = h('div', { class: 'tree' });
    const panelHost = h('section', { class: 'panel' });
    const asideHost = h('aside', { class: 'aside' });
    this.els.discoveries = h('div', { class: 'mini-feed' });
    this.els.hint = h('div', { class: 'hint muted small' });
    asideHost.append(
      h('h3', { class: 'aside-title', text: 'Recent discoveries' }),
      this.els.discoveries,
      this.els.hint,
    );

    const main = h('main', { class: 'board' }, treeHost, panelHost, asideHost);
    this.els.toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });

    app.append(bar, main, this.els.toast);

    this.tree = new TreeView(treeHost, {
      rowHeight: 26,
      overscan: 8,
      onSelect: (p) => this.focus(p),
      onToggle: (p) => this.toggleExpand(p),
      detail: (n) => `${fmt(this.engine.rates[n.path] ?? 0, this.notation)}/s`,
      badge: (n) => (n.anomaly ? n.anomaly[0].toUpperCase() : ''),
    });

    this.panel = new NodePanel(panelHost, this.engine, {
      onBuy: (p, g, amount) => this.buy(p, g, amount),
      onOpen: (p, g) => this.openDoor(p, g),
      onFocus: (p) => this.focus(p),
      onChannel: (p) => this.channel(p),
      onAuto: (p, g, s) => {
        this.engine.setAuto(p, g, s);
        this.panel.update();
      },
    });

    this.refreshTree();
    this.panel.sync(this.engine.state.run.focus);
    this.renderMiniFeed();

    document.addEventListener('keydown', this.onKey);
    app.addEventListener('pointerdown', () => unlockAudio(), { once: true });
  }

  private screenDeps(): ScreenDeps {
    return {
      engine: this.engine,
      sigils: this.sigils,
      onSettingsChange: () => {
        this.applyMotionPreference();
        this.panel.update();
        this.tree.refresh();
        void this.save();
      },
      onExport: () => openExport(exportSave(this.engine.state), (m) => this.toast(m)),
      onImport: (json) => this.importSave(json),
      onErase: () => void this.erase(),
      onReseed: (seed) => {
        this.engine.reseed(seed);
        this.refreshTree();
        this.panel.sync('');
        this.toast(`New tree on seed ${seed}`);
        void this.save();
      },
      toast: (m) => this.toast(m),
    };
  }

  // -------------------------------------------------------------------------
  // loop
  // -------------------------------------------------------------------------

  private frame = (now: number): void => {
    const dtMs = Math.min(2000, now - this.lastFrame);
    this.lastFrame = now;

    if (!this.ritualBusy) {
      this.accumulator += dtMs / 1000;
      let steps = 0;
      while (this.accumulator >= TICK && steps < MAX_CATCHUP_STEPS) {
        this.accumulator -= TICK;
        steps++;
        if (this.worker && this.workerReady) this.simulateViaWorker(TICK);
        else this.engine.step(TICK, TICK * 1000);
      }
      // If we blew the catch-up budget, drop the backlog rather than spiral.
      if (this.accumulator > TICK * MAX_CATCHUP_STEPS) this.accumulator = 0;
    }

    this.render();

    if (now - this.lastSaveAt > SAVE_EVERY_MS) {
      this.lastSaveAt = now;
      void this.save();
    }

    if (this.fpsSamples.push(dtMs) > 120) this.fpsSamples.shift();
    requestAnimationFrame(this.frame);
  };

  private render(): void {
    const engine = this.engine;
    const rate = engine.rates[''] ?? 0;
    const progress = engine.goalProgress();

    this.els.output.textContent = `${fmt(rate, this.notation)}/s`;
    this.els.goal.textContent = `${fmt(engine.root?.lifetime ?? 0, this.notation)} / ${fmt(
      GOAL,
      this.notation,
    )} · ${pct(progress)}`;
    this.els.goalBar.style.width = `${(progress * 100).toFixed(2)}%`;
    this.els.mult.textContent = `×${engine.globalMult().toFixed(2)}`;
    this.els.nodes.textContent = `${engine.order.length.toLocaleString()} nodes`;
    this.els.depth.textContent = `depth ${engine.state.run.deepest}`;

    if (!this.els.output) return;
    const canReset = engine.canCollapse() || engine.canEpoch() || engine.canGenesis();
    this.els.resetBtn.classList.toggle('is-ready', canReset);

    this.panel.update();
    this.tree.refresh();
    this.updateHint();
  }

  /** A single line of "here is what to do next", driven by actual state. */
  private updateHint(): void {
    const engine = this.engine;
    const node = engine.state.run.nodes[engine.state.run.focus];
    let msg: string;
    if (engine.canGenesis()) msg = 'Genesis is available. The language itself can change.';
    else if (engine.canEpoch()) msg = 'An Epoch is available. Trade the multiplier for the exponent.';
    else if (engine.canCollapse()) msg = 'The root has reached the goal. Collapse it.';
    else if (engine.order.length === 1) msg = 'Buy ten of a generator to open its first door.';
    else if (node && node.gens.every((g) => g.door !== null)) {
      msg = 'Every door here is open. Go down one and widen that layer too.';
    } else if (engine.order.length < 8) {
      msg = 'Two doors on one layer beat ten doors in a line. Widen before you deepen.';
    } else {
      msg = `${Object.keys(engine.state.meta.codex).length} species logged. The codex survives the reset.`;
    }
    if (this.els.hint.textContent !== msg) this.els.hint.textContent = msg;
  }

  // -------------------------------------------------------------------------
  // worker
  // -------------------------------------------------------------------------

  private startWorkerIfNeeded(): void {
    if (this.worker || this.engine.order.length < WORKER_THRESHOLD) return;
    try {
      this.worker = new Worker(new URL('./workers/sim.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (ev: MessageEvent<RatesMsg | { type: 'ready' }>) => {
        if (ev.data.type === 'ready') {
          this.workerReady = true;
          return;
        }
        this.onWorkerRates(ev.data as RatesMsg);
      };
      this.worker.onerror = () => this.stopWorker();
      this.syncWorkerModel();
    } catch {
      // Workers are not available everywhere (some embedded webviews); the
      // main-thread path is correct on its own, just slower.
      this.worker = null;
    }
  }

  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = false;
    this.workerBusy = false;
  }

  private syncWorkerModel(): void {
    if (!this.worker) return;
    this.model = buildSimModel(this.engine.tree);
    this.genIndexOf.clear();
    for (let i = 0; i < this.model.nodeCount; i++) {
      const path = this.model.paths[i];
      const start = this.model.genOff[i];
      const count = this.model.genOff[i + 1] - start;
      for (let g = 0; g < count; g++) this.genIndexOf.set(`${path}#${g}`, start + g);
    }
    const { payload, transfer } = toBuffers(buildSimModel(this.engine.tree));
    this.workerReady = false;
    this.pendingCounts.length = 0;
    const msg: SimRequest = { cmd: 'init', model: payload };
    this.worker.postMessage(msg, transfer);
  }

  /**
   * The worker holds the tree shape and generator counts; the main thread
   * keeps currency. Rates come back, currency is integrated here, so the
   * worker can never drift away from the save.
   */
  private simulateViaWorker(dt: number): void {
    if (!this.worker || !this.model) return;
    this.flushCounts();
    if (this.workerBusy) {
      // A frame arrived before the last answer did; keep the clock honest by
      // stepping on the main thread rather than dropping simulated time.
      this.engine.step(dt, dt * 1000);
      return;
    }
    this.workerBusy = true;
    this.pendingDt = dt;
    const msg: SimRequest = { cmd: 'tick', id: ++this.tickId, params: this.engine.params() };
    this.worker.postMessage(msg);
  }

  private tickId = 0;
  private pendingDt = TICK;

  private onWorkerRates(msg: RatesMsg): void {
    this.workerBusy = false;
    if (!this.model || msg.nodeCount !== this.model.nodeCount) return;
    const rates = new Float64Array(msg.rates);
    const yields = new Float64Array(msg.yields);
    const maps = emptyRateMaps();
    for (let i = 0; i < this.model.nodeCount; i++) {
      const path = this.model.paths[i];
      maps.output[path] = rates[i];
      maps.yield[path] = yields[i];
    }
    this.engine.stepWithRates(maps, this.pendingDt, this.pendingDt * 1000);
  }

  private flushCounts(): void {
    if (!this.worker || !this.pendingCounts.length) return;
    const idx = new Int32Array(this.pendingCounts.length);
    const val = new Float64Array(this.pendingCounts.length);
    for (let i = 0; i < this.pendingCounts.length; i++) {
      idx[i] = this.pendingCounts[i][0];
      val[i] = this.pendingCounts[i][1];
    }
    this.pendingCounts.length = 0;
    const msg: SimRequest = { cmd: 'counts', idx: idx.buffer, val: val.buffer };
    this.worker.postMessage(msg, [idx.buffer, val.buffer]);
  }

  private noteCount(path: string, gen: number): void {
    if (!this.worker || !this.model) return;
    const flat = this.genIndexOf.get(`${path}#${gen}`);
    if (flat === undefined) return;
    const node = this.engine.state.run.nodes[path];
    if (node) this.pendingCounts.push([flat, node.gens[gen].n]);
  }

  private onStructureChanged(): void {
    if (!this.engine) return;
    this.startWorkerIfNeeded();
    if (this.worker) this.syncWorkerModel();
  }

  // -------------------------------------------------------------------------
  // actions
  // -------------------------------------------------------------------------

  private get notation() {
    return this.engine.state.meta.settings.notation;
  }

  private buy(path: string, gen: number, amount: 'one' | 'max'): void {
    const got =
      amount === 'max' ? this.engine.buyMax(path, gen) : this.engine.buy(path, gen, 1);
    if (got > 0) {
      this.noteCount(path, gen);
      blip(320 + gen * 60, this.engine.state.meta.settings.sound, 0.03, 45);
      this.panel.update();
      this.engine.checkAchievements();
    }
  }

  private channel(path: string): void {
    this.engine.channel(path);
    blip(180, this.engine.state.meta.settings.sound, 0.025, 60);
    haptic([12], this.engine.state.meta.settings.haptics);
    this.panel.update();
  }

  private openDoor(path: string, gen: number): void {
    if (this.engine.order.length >= MAX_NODES) {
      this.toast(`The tree is at its ceiling of ${MAX_NODES.toLocaleString()} nodes.`);
      return;
    }
    const node = this.engine.openDoor(path, gen);
    if (!node) return;
    blip(520, this.engine.state.meta.settings.sound, 0.05, 120);
    haptic([18, 30, 18], this.engine.state.meta.settings.haptics);
    this.refreshTree();
    this.focus(node.path);
    this.engine.checkAchievements();
  }

  private focus(path: string): void {
    if (!this.engine.state.run.nodes[path]) return;
    this.engine.state.run.focus = path;
    this.tree.setSelected(path);
    this.tree.reveal(path);
    this.panel.sync(path);
  }

  private toggleExpand(path: string): void {
    const exp = this.engine.state.run.expanded;
    if (exp[path]) delete exp[path];
    else exp[path] = 1;
    this.refreshTree();
  }

  private refreshTree(): void {
    this.tree.setTree(
      this.engine.state.run.nodes,
      this.engine.state.run.expanded,
      this.engine.state.run.focus,
    );
  }

  // -------------------------------------------------------------------------
  // prestige
  // -------------------------------------------------------------------------

  private openPrestige(): void {
    openPrestige(
      this.screenDeps(),
      () => void this.doPrestige('collapse'),
      () => void this.doPrestige('epoch'),
      () => void this.doPrestige('genesis'),
    );
  }

  private async doPrestige(kind: 'collapse' | 'epoch' | 'genesis'): Promise<void> {
    const res =
      kind === 'collapse'
        ? this.engine.collapse()
        : kind === 'epoch'
          ? this.engine.epoch()
          : this.engine.genesis();
    if (!res) return;

    this.ritualBusy = true;
    this.refreshTree();
    this.panel.sync('');
    this.renderMiniFeed();
    await this.save();
    await playRitual(document.body, kind, {
      reducedMotion: this.reduced,
      sound: this.engine.state.meta.settings.sound,
      haptics: this.engine.state.meta.settings.haptics,
      headline: res.headline,
      detail: res.detail,
    });
    this.ritualBusy = false;
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.engine.checkAchievements();
  }

  // -------------------------------------------------------------------------
  // codex feedback
  // -------------------------------------------------------------------------

  private onDiscovery(key: string, node: NodeData): void {
    // Freeze the species' thumbnail the first time it is seen, so the codex
    // shows the sigil of the specimen that earned the entry.
    try {
      speciesThumb(key, this.engine.state.meta.settings.sigilMode, this.sigils);
    } catch {
      /* canvas may be unavailable; the codex falls back to text */
    }
    this.toast(`New species: ${node.name} — ${speciesTitle(key)}`);
    blip(660, this.engine.state.meta.settings.sound, 0.045, 160);
    this.renderMiniFeed();
  }

  private renderMiniFeed(): void {
    if (!this.els.discoveries) return;
    const feed = this.engine.state.meta.feed.slice(0, 24);
    this.els.discoveries.textContent = '';
    if (!feed.length) {
      this.els.discoveries.appendChild(
        h('p', { class: 'muted small', text: 'Nothing logged yet.' }),
      );
      return;
    }
    for (const d of feed) {
      this.els.discoveries.appendChild(
        h(
          'div',
          { class: 'mini-row' },
          h('span', {
            class: 'mini-dot',
            style: `background:${readableAccent(this.engine.state.meta.codex[d.key] ? hueOf(d.key) : 0)}`,
          }),
          h(
            'span',
            { class: 'mini-text' },
            h('b', { text: d.name }),
            h('span', { class: 'muted small', text: ` ${speciesTitle(d.key)}` }),
          ),
        ),
      );
    }
  }

  // -------------------------------------------------------------------------
  // persistence
  // -------------------------------------------------------------------------

  private async save(): Promise<void> {
    try {
      this.engine.state.lastSaved = Date.now();
      await this.kv.set(SAVE_KEY, exportSave(this.engine.state));
      await this.kv.set(SIGIL_KEY, JSON.stringify(this.sigils));
    } catch (err) {
      console.warn('save failed', err);
      this.toast('Could not save — export a copy from Settings.');
    }
  }

  private importSave(json: string): void {
    const state = importSave(json, Date.now());
    this.engine = new Engine(state);
    this.engine.events = {
      onDiscovery: (e) => this.onDiscovery(e.entry.key, e.node),
      onAchievement: (a) => this.toast(`Achievement: ${a.name}`),
      onStructure: () => this.onStructureChanged(),
    };
    this.engine.noteAllSpecies(Date.now());
    this.engine.refreshRates();
    this.stopWorker();
    this.buildDom();
    this.startWorkerIfNeeded();
    this.toast('Save imported');
    void this.save();
  }

  private async erase(): Promise<void> {
    await this.kv.del(SAVE_KEY);
    await this.kv.del(SIGIL_KEY);
    this.sigils = {};
    location.reload();
  }

  private offerSeed(seed: number): void {
    this.toast(`This link carries seed ${seed} — start a new tree on it from Settings.`);
  }

  // -------------------------------------------------------------------------
  // misc
  // -------------------------------------------------------------------------

  private showWelcomeBack(summary: OfflineSummary): void {
    openWelcomeBack(summary, this.screenDeps());
  }

  private applyMotionPreference(): void {
    this.reduced = prefersReducedMotion(this.engine.state.meta.settings.motion);
    document.documentElement.classList.toggle('reduced-motion', this.reduced);
    if (this.panel) this.panel.stillFrames = this.reduced;
  }

  private toast(msg: string): void {
    // Engine events can fire during boot, before buildDom has run — a
    // discovery logged while classifying a loaded tree, for instance.
    if (!this.els.toast) return;
    this.els.toast.textContent = msg;
    this.els.toast.classList.add('is-on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.els.toast.classList.remove('is-on'), 3600);
  }

  private onKey = (ev: KeyboardEvent): void => {
    const target = ev.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (document.querySelector('.scrim')) return;

    const path = this.engine.state.run.focus;
    const node = this.engine.state.run.nodes[path];
    const deps = this.screenDeps();

    if (ev.key >= '1' && ev.key <= '9') {
      const i = Number(ev.key) - 1;
      if (node && node.gens[i]) {
        ev.preventDefault();
        if (ev.shiftKey) {
          if (doorReady(node.gens[i])) this.openDoor(path, i);
          else if (node.gens[i].door !== null) this.focus(node.gens[i].door!);
        } else {
          this.buy(path, i, 'one');
        }
      }
      return;
    }

    switch (ev.key.toLowerCase()) {
      case 'c':
        ev.preventDefault();
        this.channel(path);
        break;
      case 'm': {
        if (!node) break;
        ev.preventDefault();
        let best = -1;
        let score = 0;
        for (let i = 0; i < node.gens.length; i++) {
          if (genMaxBuy(node.gens[i], node.currency) < 1) continue;
          const s = buyEfficiency(node, i);
          if (s > score) {
            score = s;
            best = i;
          }
        }
        if (best >= 0) this.buy(path, best, 'max');
        break;
      }
      case 'x':
        openCodex(deps);
        break;
      case 'f':
        openFeed(deps);
        break;
      case 'a':
        openAchievements(deps);
        break;
      case 's':
        openStats(deps);
        break;
      case 'r':
        this.openPrestige();
        break;
      case ',':
        openSettings(deps);
        break;
      case '?':
      case '/':
        openHelp();
        break;
      case 'u': {
        // up to the parent layer
        if (path === '') break;
        const cut = path.lastIndexOf('.');
        this.focus(cut === -1 ? '' : path.slice(0, cut));
        break;
      }
      default:
        break;
    }
  };
}

function hueOf(key: string): number {
  let h2 = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h2 ^= key.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193);
  }
  return (h2 >>> 0) % 360;
}

// ---------------------------------------------------------------------------

const game = new Game();
void game.boot().catch((err) => {
  console.error(err);
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML =
      '<div class="fatal"><h1>RECURSE failed to start</h1>' +
      `<p>${String(err)}</p><p>Your save is untouched. Reload to try again.</p></div>`;
  }
});

if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    // Registered relative to the page, not the module: the built bundle lives
    // under /assets/ but the worker is copied to the site root by Vite.
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // offline support is a bonus; the game runs fine without it
    });
  });
}

export { dur };
