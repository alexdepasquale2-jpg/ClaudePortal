/**
 * state.ts — save schema, versioned migrations, and the storage adapter.
 *
 * The schema is split three ways on purpose:
 *   run       — wiped by Collapse
 *   progress  — prestige counters, wiped by Epoch / Genesis
 *   meta      — codex, feed, achievements, stats, settings. Wiped by NOTHING
 *               except an explicit, confirmed full erase.
 *
 * That last line is the whole permanent-progress design. Anything that should
 * survive a Collapse belongs in `meta` and nowhere else.
 */

import {
  makeNode,
  hash,
  BANKS,
  deriveBank,
  type Anomaly,
  type Arch,
  type NodeData,
  type PhonemeBank,
  type Tier,
} from './procgen';
import { clampFinite } from './economy';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'recurse.save.v1';
export const SIGIL_KEY = 'recurse.sigils.v1';

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

export interface CodexEntry {
  key: string;
  /** The name of the first specimen ever seen of this species. */
  name: string;
  description: string;
  tier: Tier;
  arch: Arch;
  anomaly: Anomaly | null;
  firstSeen: number;
  /** Depth the first specimen was found at. */
  depth: number;
  /** How many specimens of this species have ever been created. */
  seen: number;
  /** Which epoch/genesis the first specimen was found in. */
  era: string;
}

export interface Discovery {
  key: string;
  name: string;
  at: number;
  depth: number;
}

export interface HistoryEntry {
  kind: 'collapse' | 'epoch' | 'genesis';
  at: number;
  /** Milliseconds this run took. */
  durationMs: number;
  /** Counter value after the event. */
  index: number;
  deepest: number;
  nodes: number;
}

export interface Stats {
  /** Currency produced by every root, ever, across all epochs. */
  lifetimeAll: number;
  deepestDepth: number;
  nodesEverCreated: number;
  doorsEverOpened: number;
  unitsEverBought: number;
  channels: number;
  fastestCollapseMs: number;
  playtimeMs: number;
  totalCollapses: number;
  totalEpochs: number;
  totalGenesis: number;
  offlineMsClaimed: number;
}

export type SigilMode = 'fractal' | 'spiral' | 'rings';
export type MotionPref = 'auto' | 'full' | 'reduced';

export interface Settings {
  sigilMode: SigilMode;
  motion: MotionPref;
  sound: boolean;
  haptics: boolean;
  /** Notation for large numbers. */
  notation: 'scientific' | 'engineering' | 'letters';
  /** Default interval for newly enabled auto-buyers, in seconds. */
  autoInterval: number;
  autoDescend: boolean;
  showOffscreenHints: boolean;
}

export interface Progress {
  collapses: number;
  epochs: number;
  genesis: number;
  /** Epoch laws unlocked, by id, in unlock order. */
  laws: string[];
  /** Which phoneme bank the current genesis names things from. */
  bankIndex: number;
  bankSeed: number;
}

export interface Run {
  /** Root seed. Shareable via ?seed=. */
  seed: number;
  startedAt: number;
  /** Simulation seconds elapsed in this run — drives pulse phase. */
  t: number;
  nodes: Record<string, NodeData>;
  /** Path of the node the player is looking at. */
  focus: string;
  /** Paths expanded in the tree view. */
  expanded: Record<string, 1>;
  /** Nodes created this run, for the history entry. */
  created: number;
  deepest: number;
}

export interface Meta {
  codex: Record<string, CodexEntry>;
  feed: Discovery[];
  /** Achievement id -> timestamp unlocked. */
  achievements: Record<string, number>;
  stats: Stats;
  settings: Settings;
  history: HistoryEntry[];
  /** First time this save was ever created. */
  bornAt: number;
}

export interface GameState {
  version: number;
  run: Run;
  progress: Progress;
  meta: Meta;
  lastSaved: number;
}

/** Kept out of the main save; PNG thumbnails are bulky and regenerable. */
export type SigilCache = Record<string, string>;

export const FEED_LIMIT = 400;
export const HISTORY_LIMIT = 500;

// ---------------------------------------------------------------------------
// construction
// ---------------------------------------------------------------------------

export function defaultSettings(): Settings {
  return {
    sigilMode: 'fractal',
    motion: 'auto',
    sound: true,
    haptics: true,
    notation: 'scientific',
    autoInterval: 3,
    autoDescend: false,
    showOffscreenHints: true,
  };
}

export function defaultStats(): Stats {
  return {
    lifetimeAll: 0,
    deepestDepth: 0,
    nodesEverCreated: 0,
    doorsEverOpened: 0,
    unitsEverBought: 0,
    channels: 0,
    fastestCollapseMs: 0,
    playtimeMs: 0,
    totalCollapses: 0,
    totalEpochs: 0,
    totalGenesis: 0,
    offlineMsClaimed: 0,
  };
}

export function defaultProgress(): Progress {
  return { collapses: 0, epochs: 0, genesis: 0, laws: [], bankIndex: 0, bankSeed: 0 };
}

export function bankFor(progress: Progress): PhonemeBank {
  if (progress.bankIndex < BANKS.length) return BANKS[progress.bankIndex];
  return deriveBank(progress.bankIndex, progress.bankSeed);
}

/** Fresh run, same meta. This is what Collapse produces. */
export function newRun(seed: number, now: number, bank: PhonemeBank, opts: {
  archs?: readonly Arch[];
  anomalies?: readonly Anomaly[];
  bloomDouble?: boolean;
} = {}): Run {
  const root = makeNode('', seed >>> 0, 0, { bank, createdAt: now, ...opts });
  return {
    seed: seed >>> 0,
    startedAt: now,
    t: 0,
    nodes: { '': root },
    focus: '',
    expanded: { '': 1 },
    created: 1,
    deepest: 0,
  };
}

export function newGame(seed: number, now: number): GameState {
  const progress = defaultProgress();
  return {
    version: SAVE_VERSION,
    run: newRun(seed, now, bankFor(progress)),
    progress,
    meta: {
      codex: {},
      feed: [],
      achievements: {},
      stats: defaultStats(),
      settings: defaultSettings(),
      history: [],
      bornAt: now,
    },
    lastSaved: now,
  };
}

/** Seed for a brand-new run. Honours ?seed= so two players can compare trees. */
export function seedFromUrl(search: string): number | null {
  const m = /[?&]seed=([^&]+)/.exec(search);
  if (!m) return null;
  const raw = decodeURIComponent(m[1]);
  if (/^\d+$/.test(raw)) return Number(raw) >>> 0;
  return hash(raw);
}

export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] >>> 0;
  }
  return (Math.random() * 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// migrations
// ---------------------------------------------------------------------------

export type Migration = (save: any) => any;

/**
 * Keyed by the version being migrated *from*. Each entry must return a save
 * one version newer. Missing versions are treated as 0 (pre-versioning).
 */
export const MIGRATIONS: Record<number, Migration> = {
  // 0 -> 1: pre-release saves had no `version`, no split between run/progress/
  // meta, and stored the tree as a bare object at the top level.
  0: (old: any) => {
    const now = Date.now();
    const progress: Progress = {
      ...defaultProgress(),
      collapses: num(old?.collapses, 0),
    };
    return {
      version: 1,
      run: {
        seed: num(old?.seed, randomSeed()) >>> 0,
        startedAt: num(old?.startedAt, now),
        t: num(old?.t, 0),
        nodes: old?.nodes && typeof old.nodes === 'object' ? old.nodes : {},
        focus: typeof old?.focus === 'string' ? old.focus : '',
        expanded: { '': 1 },
        created: num(old?.created, 1),
        deepest: num(old?.deepest, 0),
      },
      progress,
      meta: {
        codex: old?.codex && typeof old.codex === 'object' ? old.codex : {},
        feed: Array.isArray(old?.feed) ? old.feed : [],
        achievements: old?.achievements ?? {},
        stats: { ...defaultStats(), ...(old?.stats ?? {}) },
        settings: { ...defaultSettings(), ...(old?.settings ?? {}) },
        history: Array.isArray(old?.history) ? old.history : [],
        bornAt: num(old?.bornAt, now),
      },
      lastSaved: num(old?.lastSaved, now),
    };
  },
};

export function migrate(save: any): any {
  let s = save;
  let v = Number.isFinite(s?.version) ? Math.floor(s.version) : 0;
  let guard = 0;
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`no migration from save version ${v}`);
    s = step(s);
    const next = Number.isFinite(s?.version) ? Math.floor(s.version) : v + 1;
    if (next <= v) throw new Error(`migration from ${v} did not advance the version`);
    v = next;
    if (++guard > 64) throw new Error('migration loop');
  }
  if (v > SAVE_VERSION) {
    throw new Error(
      `save is from a newer version (${v}) than this build supports (${SAVE_VERSION})`,
    );
  }
  return s;
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

function num(x: unknown, fallback: number): number {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function finite(x: unknown, fallback = 0): number {
  return clampFinite(num(x, fallback));
}

/**
 * Coerce an arbitrary parsed blob into a GameState we are willing to run.
 * Import is a hostile input path: a corrupt node must not be able to inject
 * NaN into the rate loop, where it would spread to the whole tree in one tick.
 */
export function hydrate(raw: any, now: number): GameState {
  const save = migrate(raw);
  const progress: Progress = {
    collapses: Math.max(0, Math.floor(num(save?.progress?.collapses, 0))),
    epochs: Math.max(0, Math.floor(num(save?.progress?.epochs, 0))),
    genesis: Math.max(0, Math.floor(num(save?.progress?.genesis, 0))),
    laws: Array.isArray(save?.progress?.laws)
      ? save.progress.laws.filter((x: unknown) => typeof x === 'string')
      : [],
    bankIndex: Math.max(0, Math.floor(num(save?.progress?.bankIndex, 0))),
    bankSeed: num(save?.progress?.bankSeed, 0) >>> 0,
  };

  const nodes: Record<string, NodeData> = {};
  const rawNodes = save?.run?.nodes;
  if (rawNodes && typeof rawNodes === 'object') {
    for (const path of Object.keys(rawNodes)) {
      const n = hydrateNode(path, rawNodes[path]);
      if (n) nodes[path] = n;
    }
  }
  if (!nodes['']) {
    // A save without a root is not recoverable as a run; start a fresh tree
    // rather than refusing to load and stranding the player's codex.
    const seed = num(save?.run?.seed, randomSeed()) >>> 0;
    Object.assign(nodes, newRun(seed, now, bankFor(progress)).nodes);
  }
  pruneDanglingDoors(nodes);

  const run: Run = {
    seed: num(save?.run?.seed, randomSeed()) >>> 0,
    startedAt: num(save?.run?.startedAt, now),
    t: Math.max(0, finite(save?.run?.t, 0)),
    nodes,
    focus: typeof save?.run?.focus === 'string' && nodes[save.run.focus] ? save.run.focus : '',
    expanded: sanitizeExpanded(save?.run?.expanded, nodes),
    created: Math.max(1, Math.floor(num(save?.run?.created, Object.keys(nodes).length))),
    deepest: Math.max(0, Math.floor(num(save?.run?.deepest, 0))),
  };

  const meta: Meta = {
    codex: hydrateCodex(save?.meta?.codex),
    feed: Array.isArray(save?.meta?.feed)
      ? save.meta.feed
          .filter((d: any) => d && typeof d.key === 'string')
          .slice(0, FEED_LIMIT)
          .map((d: any) => ({
            key: String(d.key),
            name: String(d.name ?? d.key),
            at: num(d.at, now),
            depth: Math.max(0, Math.floor(num(d.depth, 0))),
          }))
      : [],
    achievements: hydrateAchievements(save?.meta?.achievements),
    stats: hydrateStats(save?.meta?.stats),
    settings: { ...defaultSettings(), ...sanitizeSettings(save?.meta?.settings) },
    history: Array.isArray(save?.meta?.history)
      ? save.meta.history
          .filter((h: any) => h && (h.kind === 'collapse' || h.kind === 'epoch' || h.kind === 'genesis'))
          .slice(-HISTORY_LIMIT)
          .map((h: any) => ({
            kind: h.kind,
            at: num(h.at, now),
            durationMs: Math.max(0, num(h.durationMs, 0)),
            index: Math.max(0, Math.floor(num(h.index, 0))),
            deepest: Math.max(0, Math.floor(num(h.deepest, 0))),
            nodes: Math.max(0, Math.floor(num(h.nodes, 0))),
          }))
      : [],
    bornAt: num(save?.meta?.bornAt, now),
  };

  return {
    version: SAVE_VERSION,
    run,
    progress,
    meta,
    lastSaved: num(save?.lastSaved, now),
  };
}

function hydrateNode(path: string, raw: any): NodeData | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.gens) || raw.gens.length === 0) {
    return null;
  }
  const depth = path === '' ? 0 : path.split('.').length;
  const gens = raw.gens
    .filter((g: any) => g && typeof g === 'object')
    .map((g: any) => ({
      name: String(g.name ?? '?'),
      seed: num(g.seed, 0) >>> 0,
      arch: g.arch,
      base: Math.max(0, finite(g.base, 1)),
      c0: Math.max(1e-6, finite(g.c0, 9)),
      gr: Math.min(4, Math.max(1.000001, finite(g.gr, 1.09))),
      n: Math.max(0, Math.floor(num(g.n, 0))),
      door: typeof g.door === 'string' ? g.door : null,
      autoEvery: Math.max(0, finite(g.autoEvery, 0)),
      autoAt: Math.max(0, finite(g.autoAt, 0)),
      bought: Math.max(0, Math.floor(num(g.bought, 0))),
    }));
  if (!gens.length) return null;
  return {
    path,
    seed: num(raw.seed, hash(path)) >>> 0,
    name: String(raw.name ?? 'Unnamed'),
    hue: ((Math.floor(num(raw.hue, 0)) % 360) + 360) % 360,
    depth,
    anomaly: raw.anomaly === null || raw.anomaly === undefined ? null : raw.anomaly,
    gens,
    currency: Math.max(0, finite(raw.currency, 0)),
    lifetime: Math.max(0, finite(raw.lifetime, 0)),
    species: String(raw.species ?? ''),
    sigil: {
      branches: Math.min(8, Math.max(2, Math.floor(num(raw?.sigil?.branches, 3)))),
      angle: finite(raw?.sigil?.angle, 0.6),
      shrink: Math.min(0.95, Math.max(0.2, finite(raw?.sigil?.shrink, 0.68))),
      twist: finite(raw?.sigil?.twist, 0),
      wobble: Math.max(0, finite(raw?.sigil?.wobble, 0)),
      hue: ((Math.floor(num(raw?.sigil?.hue, num(raw.hue, 0))) % 360) + 360) % 360,
    },
    createdAt: num(raw.createdAt, 0),
  };
}

/** A door pointing at a node that did not survive load must be closed. */
export function pruneDanglingDoors(nodes: Record<string, NodeData>): void {
  for (const path of Object.keys(nodes)) {
    for (const g of nodes[path].gens) {
      if (g.door !== null && !nodes[g.door]) g.door = null;
    }
  }
  // drop orphans whose parent chain no longer resolves
  for (const path of Object.keys(nodes)) {
    if (path === '') continue;
    let p = path;
    let ok = true;
    while (p !== '') {
      const i = p.lastIndexOf('.');
      const parent = i === -1 ? '' : p.slice(0, i);
      if (!nodes[parent]) {
        ok = false;
        break;
      }
      p = parent;
    }
    if (!ok) delete nodes[path];
  }
}

function sanitizeExpanded(raw: any, nodes: Record<string, NodeData>): Record<string, 1> {
  const out: Record<string, 1> = { '': 1 };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(raw)) if (nodes[k]) out[k] = 1;
  }
  return out;
}

function hydrateCodex(raw: any): Record<string, CodexEntry> {
  const out: Record<string, CodexEntry> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(raw)) {
    const e = raw[key];
    if (!e || typeof e !== 'object') continue;
    out[key] = {
      key,
      name: String(e.name ?? key),
      description: String(e.description ?? ''),
      tier: e.tier,
      arch: e.arch,
      anomaly: e.anomaly ?? null,
      firstSeen: num(e.firstSeen, 0),
      depth: Math.max(0, Math.floor(num(e.depth, 0))),
      seen: Math.max(1, Math.floor(num(e.seen, 1))),
      era: String(e.era ?? 'E0'),
    };
  }
  return out;
}

function hydrateAchievements(raw: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(raw)) {
    const v = num(raw[k], 0);
    if (v > 0) out[k] = v;
  }
  return out;
}

function hydrateStats(raw: any): Stats {
  const d = defaultStats();
  if (!raw || typeof raw !== 'object') return d;
  const out = { ...d };
  for (const k of Object.keys(d) as (keyof Stats)[]) {
    out[k] = Math.max(0, finite(raw[k], d[k]));
  }
  return out;
}

function sanitizeSettings(raw: any): Partial<Settings> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Settings> = {};
  if (raw.sigilMode === 'fractal' || raw.sigilMode === 'spiral' || raw.sigilMode === 'rings') {
    out.sigilMode = raw.sigilMode;
  }
  if (raw.motion === 'auto' || raw.motion === 'full' || raw.motion === 'reduced') {
    out.motion = raw.motion;
  }
  if (typeof raw.sound === 'boolean') out.sound = raw.sound;
  if (typeof raw.haptics === 'boolean') out.haptics = raw.haptics;
  if (raw.notation === 'scientific' || raw.notation === 'engineering' || raw.notation === 'letters') {
    out.notation = raw.notation;
  }
  const ai = num(raw.autoInterval, NaN);
  if (Number.isFinite(ai)) out.autoInterval = Math.min(30, Math.max(0.5, ai));
  if (typeof raw.autoDescend === 'boolean') out.autoDescend = raw.autoDescend;
  if (typeof raw.showOffscreenHints === 'boolean') out.showOffscreenHints = raw.showOffscreenHints;
  return out;
}

// ---------------------------------------------------------------------------
// export / import — the primary defence against data loss
// ---------------------------------------------------------------------------

export function exportSave(state: GameState): string {
  return JSON.stringify({ ...state, exportedAt: Date.now(), app: 'RECURSE' });
}

export function importSave(json: string, now: number): GameState {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') throw new Error('not a save object');
  return hydrate(parsed, now);
}

// ---------------------------------------------------------------------------
// storage adapter
// ---------------------------------------------------------------------------

/**
 * Everything persistent goes through this. IndexedDB is the default, but the
 * game only ever needs get/set/del on strings, so a localStorage or host-
 * provided `window.storage` implementation is a drop-in.
 */
export interface KVAdapter {
  readonly name: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export class MemoryAdapter implements KVAdapter {
  readonly name = 'memory';
  private map = new Map<string, string>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.map.set(key, value);
  }
  async del(key: string) {
    this.map.delete(key);
  }
}

export class LocalStorageAdapter implements KVAdapter {
  readonly name = 'localStorage';
  async get(key: string) {
    return globalThis.localStorage.getItem(key);
  }
  async set(key: string, value: string) {
    globalThis.localStorage.setItem(key, value);
  }
  async del(key: string) {
    globalThis.localStorage.removeItem(key);
  }
}

export class IndexedDbAdapter implements KVAdapter {
  readonly name = 'indexedDB';
  private db: Promise<IDBDatabase>;
  constructor(dbName = 'recurse', private store = 'kv') {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.store)) db.createObjectStore(this.store);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.db;
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(this.store, mode);
      const req = fn(t.objectStore(this.store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  }
  async get(key: string) {
    const v = await this.tx<string | undefined>('readonly', (s) => s.get(key));
    return v ?? null;
  }
  async set(key: string, value: string) {
    await this.tx('readwrite', (s) => s.put(value, key));
  }
  async del(key: string) {
    await this.tx('readwrite', (s) => s.delete(key));
  }
}

/** Host-provided key/value API, if the page is embedded in one. */
interface HostStorage {
  getItem?(k: string): string | null | Promise<string | null>;
  get?(k: string): string | null | Promise<string | null>;
  setItem?(k: string, v: string): unknown;
  set?(k: string, v: string): unknown;
  removeItem?(k: string): unknown;
  del?(k: string): unknown;
}

export class HostStorageAdapter implements KVAdapter {
  readonly name = 'host';
  constructor(private host: HostStorage) {}
  async get(key: string) {
    const fn = this.host.getItem ?? this.host.get;
    return fn ? ((await fn.call(this.host, key)) ?? null) : null;
  }
  async set(key: string, value: string) {
    const fn = this.host.setItem ?? this.host.set;
    if (fn) await fn.call(this.host, key, value);
  }
  async del(key: string) {
    const fn = this.host.removeItem ?? this.host.del;
    if (fn) await fn.call(this.host, key);
  }
}

/** Pick the best adapter available, degrading rather than failing. */
export async function openStorage(): Promise<KVAdapter> {
  const host = (globalThis as any).storage as HostStorage | undefined;
  if (host && (host.getItem || host.get)) {
    try {
      const a = new HostStorageAdapter(host);
      await a.get('__probe');
      return a;
    } catch {
      /* fall through */
    }
  }
  if (typeof indexedDB !== 'undefined') {
    try {
      const a = new IndexedDbAdapter();
      await a.get('__probe');
      return a;
    } catch {
      /* fall through */
    }
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const a = new LocalStorageAdapter();
      await a.get('__probe');
      return a;
    }
  } catch {
    /* fall through */
  }
  return new MemoryAdapter();
}
