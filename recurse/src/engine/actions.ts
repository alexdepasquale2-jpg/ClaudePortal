/**
 * actions.ts — everything that mutates a game. The Engine is the only place
 * that knows how the pure economy, the procgen, the codex and the prestige
 * tiers fit together; the UI talks to this and nothing else.
 */

import {
  GOAL,
  buy as buyUnits,
  buildOrder,
  channelGain,
  clampFinite,
  computeRates,
  doorReady,
  emptyRateMaps,
  genMaxBuy,
  tick,
  type RateMaps,
  type RateParams,
  type Tree,
} from './economy';
import {
  childPath,
  childSeed,
  describeSpecies,
  dominantArch,
  endowment,
  makeNode,
  parseSpecies,
  tierOf,
  type NodeData,
  type PhonemeBank,
} from './procgen';
import {
  bankFor,
  FEED_LIMIT,
  type CodexEntry,
  type GameState,
} from './state';
import {
  canCollapse,
  canEpoch,
  canGenesis,
  deriveRules,
  doCollapse,
  doEpoch,
  doGenesis,
  eraLabel,
  globalMultiplier,
  type PrestigeResult,
  type Rules,
} from './epochs';
import {
  achievementBonus,
  checkAchievements,
  surveyTree,
  type Achievement,
} from './achievements';

/** Hard ceiling on live nodes. Well past what the renderer needs to survive. */
export const MAX_NODES = 20000;
/** Offline progress is capped here — validated, do not raise casually. */
export const OFFLINE_CAP_MS = 12 * 60 * 60 * 1000;
/** Auto-buyers deliberately leave a margin, so attentive play still wins. */
export const AUTO_SPEND_FRACTION = 0.9;
export const AUTO_DESCEND_INTERVAL = 6;

export interface DiscoveryEvent {
  entry: CodexEntry;
  node: NodeData;
  isNew: boolean;
}

export interface OfflineSummary {
  awayMs: number;
  cappedMs: number;
  rootGain: number;
  totalGain: number;
  discoveries: CodexEntry[];
  achievements: Achievement[];
  nodesOpened: number;
}

export type EngineEvents = {
  onDiscovery?(e: DiscoveryEvent): void;
  onAchievement?(a: Achievement): void;
  onStructure?(): void;
  onPrestige?(r: PrestigeResult): void;
};

export class Engine {
  state: GameState;
  /** Paths deepest-first. Rebuilt only when the structure changes. */
  order: string[];
  maps: RateMaps = emptyRateMaps();
  rules: Rules;
  bonus: number;
  bank: PhonemeBank;
  events: EngineEvents = {};
  /** Paths with at least one auto-buyer enabled. */
  private autoNodes = new Set<string>();
  private autoDescendAt = 0;
  /** Set whenever nodes are added/removed, so the worker mirror can resync. */
  structureDirty = true;

  constructor(state: GameState) {
    this.state = state;
    this.order = buildOrder(state.run.nodes);
    this.rules = deriveRules(state.progress);
    this.bonus = achievementBonus(state);
    this.bank = bankFor(state.progress);
    this.rebuildAutoIndex();
  }

  get tree(): Tree {
    return { nodes: this.state.run.nodes, order: this.order };
  }

  get root(): NodeData {
    return this.state.run.nodes[''];
  }

  get nodeCount(): number {
    return this.order.length;
  }

  params(): RateParams {
    return {
      t: this.state.run.t,
      globalMult: globalMultiplier(this.state.progress, this.bonus),
      e: this.rules.e,
      voidRaw: this.rules.voidRaw,
      k: this.rules.k,
      cascadeMult: this.rules.cascadeMult,
    };
  }

  globalMult(): number {
    return globalMultiplier(this.state.progress, this.bonus);
  }

  // -------------------------------------------------------------------------
  // simulation
  // -------------------------------------------------------------------------

  /** Amplified output per node — what feeds parents and the goal. */
  get rates(): Record<string, number> {
    return this.maps.output;
  }

  /** Local yield per node — what the node actually banks and can spend. */
  get yields(): Record<string, number> {
    return this.maps.yield;
  }

  /** Recompute rates without advancing time — for UI after a purchase. */
  refreshRates(): void {
    computeRates(this.tree, this.params(), this.maps);
  }

  /**
   * Advance the whole game by `dt` simulated seconds.
   * `dtWallMs` is tracked separately so playtime is honest about offline time.
   */
  step(dt: number, dtWallMs = dt * 1000): void {
    if (!(dt > 0)) return;
    this.state.run.t += dt;
    const before = this.root ? this.root.lifetime : 0;
    tick(this.tree, dt, this.params(), this.maps);
    const after = this.root ? this.root.lifetime : 0;
    this.state.meta.stats.lifetimeAll = clampFinite(
      this.state.meta.stats.lifetimeAll + Math.max(0, after - before),
    );
    this.state.meta.stats.playtimeMs += dtWallMs;
    this.runAutomation();
  }

  /**
   * Integrate against rates computed elsewhere (the sim worker). Kept separate
   * from `step` so the worker path is never also recomputing on the main
   * thread — that would defeat the whole point of moving it off.
   */
  stepWithRates(maps: RateMaps, dt: number, dtWallMs = dt * 1000): void {
    if (!(dt > 0)) return;
    this.state.run.t += dt;
    this.maps = maps;
    const nodes = this.state.run.nodes;
    let rootGain = 0;
    for (let i = 0; i < this.order.length; i++) {
      const path = this.order[i];
      const node = nodes[path];
      if (!node) continue;
      const banked = maps.yield[path] * dt;
      if (banked > 0) node.currency = clampFinite(node.currency + banked);
      const produced = maps.output[path] * dt;
      if (produced > 0) node.lifetime = clampFinite(node.lifetime + produced);
      if (path === '') rootGain = produced;
    }
    this.state.meta.stats.lifetimeAll = clampFinite(this.state.meta.stats.lifetimeAll + rootGain);
    this.state.meta.stats.playtimeMs += dtWallMs;
    this.runAutomation();
  }

  // -------------------------------------------------------------------------
  // player actions
  // -------------------------------------------------------------------------

  buy(path: string, genIndex: number, want: number): number {
    const node = this.state.run.nodes[path];
    if (!node) return 0;
    const res = buyUnits(node, genIndex, want);
    if (res.bought > 0) {
      this.state.meta.stats.unitsEverBought += res.bought;
      this.refreshRates();
    }
    return res.bought;
  }

  buyMax(path: string, genIndex: number): number {
    const node = this.state.run.nodes[path];
    if (!node) return 0;
    return this.buy(path, genIndex, genMaxBuy(node.gens[genIndex], node.currency));
  }

  channel(path: string): number {
    const node = this.state.run.nodes[path];
    if (!node) return 0;
    const gain = channelGain(this.yields[path] ?? 0);
    node.currency = clampFinite(node.currency + gain);
    this.state.meta.stats.channels += 1;
    return gain;
  }

  canOpen(path: string, genIndex: number): boolean {
    const node = this.state.run.nodes[path];
    if (!node) return false;
    const g = node.gens[genIndex];
    return !!g && doorReady(g) && this.order.length < MAX_NODES;
  }

  /**
   * Descend. The child is deterministic in the parent's seed, so the same root
   * seed always grows the same tree — that is what makes seed-sharing mean
   * anything.
   */
  openDoor(path: string, genIndex: number, now = Date.now()): NodeData | null {
    if (!this.canOpen(path, genIndex)) return null;
    const parent = this.state.run.nodes[path];
    const g = parent.gens[genIndex];
    const cpath = childPath(path, genIndex);
    if (this.state.run.nodes[cpath]) {
      g.door = cpath;
      return this.state.run.nodes[cpath];
    }
    const node = makeNode(cpath, childSeed(parent.seed, genIndex), parent.depth + 1, {
      bank: this.bank,
      anomalyRate: this.rules.anomalyRate,
      bloomDouble: this.rules.bloomDouble,
      archs: this.rules.archs,
      anomalies: this.rules.anomalies,
      createdAt: now,
    });
    node.currency = endowment(this.rules.endowmentMult);
    this.state.run.nodes[cpath] = node;
    g.door = cpath;

    this.state.run.created += 1;
    this.state.meta.stats.nodesEverCreated += 1;
    this.state.meta.stats.doorsEverOpened += 1;
    if (node.depth > this.state.run.deepest) this.state.run.deepest = node.depth;
    if (node.depth > this.state.meta.stats.deepestDepth) {
      this.state.meta.stats.deepestDepth = node.depth;
    }
    this.state.run.expanded[path] = 1;

    this.markStructure();
    this.noteSpecies(node, now);
    this.refreshRates();
    return node;
  }

  /** Toggle a per-generator auto-buyer. `seconds` of 0 turns it off. */
  setAuto(path: string, genIndex: number, seconds: number): void {
    const node = this.state.run.nodes[path];
    if (!node || !node.gens[genIndex]) return;
    node.gens[genIndex].autoEvery = Math.max(0, seconds);
    node.gens[genIndex].autoAt = this.state.run.t;
    this.rebuildAutoIndexFor(path);
  }

  // -------------------------------------------------------------------------
  // codex
  // -------------------------------------------------------------------------

  /**
   * Classify a node and log it if its species has never been seen. This is the
   * only writer of `meta.codex`, and it is never called from a reset path with
   * anything that would clear it.
   */
  noteSpecies(node: NodeData, now: number): DiscoveryEvent {
    const tier = tierOf(node.depth);
    const key = node.species || `${tier}/${dominantArch(node.gens)}/${node.anomaly ?? 'none'}`;
    node.species = key;
    const existing = this.state.meta.codex[key];
    if (existing) {
      existing.seen += 1;
      const ev = { entry: existing, node, isNew: false };
      return ev;
    }
    const parsed = parseSpecies(key);
    const entry: CodexEntry = {
      key,
      name: node.name,
      description: describeSpecies(key, node.name),
      tier: parsed.tier,
      arch: parsed.arch,
      anomaly: parsed.anomaly,
      firstSeen: now,
      depth: node.depth,
      seen: 1,
      era: eraLabel(this.state.progress),
    };
    this.state.meta.codex[key] = entry;
    this.state.meta.feed.unshift({ key, name: node.name, at: now, depth: node.depth });
    if (this.state.meta.feed.length > FEED_LIMIT) this.state.meta.feed.length = FEED_LIMIT;
    const ev = { entry, node, isNew: true };
    this.events.onDiscovery?.(ev);
    return ev;
  }

  /** Classify every node in the tree — used after a load or a reset. */
  noteAllSpecies(now: number): void {
    for (const path of this.order) {
      const node = this.state.run.nodes[path];
      const key = node.species;
      if (key && this.state.meta.codex[key]) continue;
      this.noteSpecies(node, now);
    }
  }

  // -------------------------------------------------------------------------
  // achievements
  // -------------------------------------------------------------------------

  checkAchievements(now = Date.now()): Achievement[] {
    const survey = surveyTree(this.state.run.nodes);
    const unlocked = checkAchievements(
      {
        state: this.state,
        nodeCount: survey.nodeCount,
        codexCount: Object.keys(this.state.meta.codex).length,
        rootRate: this.rates[''] ?? 0,
        deepestNow: survey.deepestNow,
        anomaliesSeen: survey.anomaliesSeen,
        maxUnitsInOneGen: survey.maxUnitsInOneGen,
        openDoorsOnOneNode: survey.openDoorsOnOneNode,
      },
      now,
    );
    if (unlocked.length) {
      this.bonus = achievementBonus(this.state);
      for (const a of unlocked) this.events.onAchievement?.(a);
    }
    return unlocked;
  }

  // -------------------------------------------------------------------------
  // automation
  // -------------------------------------------------------------------------

  private rebuildAutoIndex(): void {
    this.autoNodes.clear();
    for (const path of Object.keys(this.state.run.nodes)) this.rebuildAutoIndexFor(path);
  }

  private rebuildAutoIndexFor(path: string): void {
    const node = this.state.run.nodes[path];
    if (!node) {
      this.autoNodes.delete(path);
      return;
    }
    const on = node.gens.some((g) => g.autoEvery > 0);
    if (on) this.autoNodes.add(path);
    else this.autoNodes.delete(path);
  }

  /**
   * Auto-buyers buy from the top tier down and never spend the last tenth of a
   * node's currency, so a player watching the node can always out-time them.
   */
  private runAutomation(): void {
    if (!this.rules.autoBuy) return;
    const t = this.state.run.t;
    let bought = 0;
    for (const path of this.autoNodes) {
      const node = this.state.run.nodes[path];
      if (!node) continue;
      for (let i = node.gens.length - 1; i >= 0; i--) {
        const g = node.gens[i];
        if (g.autoEvery <= 0 || t - g.autoAt < g.autoEvery) continue;
        g.autoAt = t;
        const budget = node.currency * AUTO_SPEND_FRACTION;
        const want = genMaxBuy(g, budget);
        if (want > 0) bought += buyUnits(node, i, want).bought;
      }
    }
    if (bought > 0) {
      this.state.meta.stats.unitsEverBought += bought;
    }
    this.autoDescend(t);
  }

  /** Very late unlock: descend into the richest door available. */
  private autoDescend(t: number): void {
    if (!this.rules.autoDescend || !this.state.meta.settings.autoDescend) return;
    if (t - this.autoDescendAt < AUTO_DESCEND_INTERVAL) return;
    this.autoDescendAt = t;
    if (this.order.length >= MAX_NODES) return;
    let bestPath: string | null = null;
    let bestGen = -1;
    let bestRate = -1;
    for (let i = 0; i < this.order.length; i++) {
      const path = this.order[i];
      const node = this.state.run.nodes[path];
      const rate = this.rates[path] ?? 0;
      if (rate <= bestRate) continue;
      for (let g = 0; g < node.gens.length; g++) {
        if (doorReady(node.gens[g])) {
          bestPath = path;
          bestGen = g;
          bestRate = rate;
          break;
        }
      }
    }
    if (bestPath !== null && bestGen >= 0) this.openDoor(bestPath, bestGen);
  }

  // -------------------------------------------------------------------------
  // offline
  // -------------------------------------------------------------------------

  /**
   * Catch up on time away, capped at 12 hours. Simulated in real steps rather
   * than multiplied out, so pulse phase, auto-buyers and auto-descend all
   * behave the way they would have if the tab had stayed open.
   */
  offline(elapsedMs: number, now = Date.now()): OfflineSummary {
    const capped = Math.max(0, Math.min(elapsedMs, OFFLINE_CAP_MS));
    const rootBefore = this.root?.lifetime ?? 0;
    const totalBefore = this.totalLifetime();
    const codexBefore = new Set(Object.keys(this.state.meta.codex));
    const nodesBefore = this.order.length;

    const seconds = capped / 1000;
    if (seconds > 0) {
      // Bounded step count keeps a 12h return from freezing the tab; 0.5s is
      // fine enough that pulse generators still average out correctly.
      const steps = Math.max(1, Math.min(4000, Math.ceil(seconds / 0.5)));
      const dt = seconds / steps;
      for (let i = 0; i < steps; i++) this.step(dt, 0);
    }
    this.state.meta.stats.offlineMsClaimed += capped;

    const discoveries: CodexEntry[] = [];
    for (const k of Object.keys(this.state.meta.codex)) {
      if (!codexBefore.has(k)) discoveries.push(this.state.meta.codex[k]);
    }
    const achievements = this.checkAchievements(now);
    return {
      awayMs: elapsedMs,
      cappedMs: capped,
      rootGain: Math.max(0, (this.root?.lifetime ?? 0) - rootBefore),
      totalGain: Math.max(0, this.totalLifetime() - totalBefore),
      discoveries,
      achievements,
      nodesOpened: this.order.length - nodesBefore,
    };
  }

  totalLifetime(): number {
    let sum = 0;
    for (const path of this.order) sum = clampFinite(sum + this.state.run.nodes[path].lifetime);
    return sum;
  }

  // -------------------------------------------------------------------------
  // prestige
  // -------------------------------------------------------------------------

  canCollapse(): boolean {
    return canCollapse(this.state);
  }
  canEpoch(): boolean {
    return canEpoch(this.state);
  }
  canGenesis(): boolean {
    return canGenesis(this.state);
  }
  goalProgress(): number {
    return Math.min(1, (this.root?.lifetime ?? 0) / GOAL);
  }

  collapse(now = Date.now()): PrestigeResult | null {
    if (!this.canCollapse()) return null;
    const res = doCollapse(this.state, now, this.bonus);
    this.afterReset(now);
    this.events.onPrestige?.(res);
    return res;
  }

  epoch(now = Date.now()): PrestigeResult | null {
    if (!this.canEpoch()) return null;
    const res = doEpoch(this.state, now);
    this.afterReset(now);
    this.events.onPrestige?.(res);
    return res;
  }

  genesis(now = Date.now()): PrestigeResult | null {
    if (!this.canGenesis()) return null;
    const res = doGenesis(this.state, now);
    this.afterReset(now);
    this.events.onPrestige?.(res);
    return res;
  }

  /** Start over on a new seed without touching prestige or the codex. */
  reseed(seed: number, now = Date.now()): void {
    this.state.run.seed = seed >>> 0;
    const rules = deriveRules(this.state.progress);
    this.state.run = {
      ...this.state.run,
      startedAt: now,
      t: 0,
      nodes: {},
      focus: '',
      expanded: { '': 1 },
      created: 1,
      deepest: 0,
    };
    this.state.run.nodes[''] = makeNode('', seed >>> 0, 0, {
      bank: this.bank,
      anomalyRate: rules.anomalyRate,
      bloomDouble: rules.bloomDouble,
      createdAt: now,
    });
    this.afterReset(now);
  }

  /** Shared tail of every reset: re-derive rules, re-index, re-log the root. */
  private afterReset(now: number): void {
    this.rules = deriveRules(this.state.progress);
    this.bank = bankFor(this.state.progress);
    this.bonus = achievementBonus(this.state);
    this.autoDescendAt = 0;
    this.markStructure();
    this.rebuildAutoIndex();
    this.state.meta.stats.nodesEverCreated += 1;
    this.noteSpecies(this.root, now);
    this.refreshRates();
    this.checkAchievements(now);
  }

  markStructure(): void {
    this.order = buildOrder(this.state.run.nodes);
    this.structureDirty = true;
    this.events.onStructure?.();
  }
}

export { GOAL };
