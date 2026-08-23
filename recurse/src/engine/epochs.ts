/**
 * epochs.ts — the three prestige tiers.
 *
 *   Collapse  root lifetime >= GOAL      -> +0.5 permanent global multiplier
 *   Epoch     COLLAPSES_PER_EPOCH        -> +E, and one new law of recursion
 *   Genesis   EPOCHS_PER_GENESIS (16)    -> +E permanently, new phoneme bank
 *
 * Each tier is roughly an order of magnitude further out than the one below
 * it, and none of them touches `meta`. The codex is not prestige currency.
 */

import { BASE_E, GOAL, K, CASCADE_E_MULT, VOID_RAW, type RateParams } from './economy';
import { ANOMALY_RATE, hash, type Anomaly, type Arch } from './procgen';
import {
  bankFor,
  newRun,
  randomSeed,
  HISTORY_LIMIT,
  type GameState,
  type HistoryEntry,
  type Progress,
} from './state';

export const COLLAPSES_PER_EPOCH = 12;
export const EPOCHS_PER_GENESIS = 16;

/** Collapse's permanent contribution to the global multiplier. */
export const COLLAPSE_MULT_STEP = 0.5;
/** Epoch's permanent contribution to the door exponent. */
export const EPOCH_E_STEP = 0.02;
/** Genesis's permanent contribution to the door exponent. */
export const GENESIS_E_STEP = 0.25;

/** Auto-buyers unlock here; auto-descend is a much later comfort. */
export const AUTOBUY_UNLOCK_COLLAPSES = 2;
export const AUTODESCEND_UNLOCK_EPOCHS = 2;

// ---------------------------------------------------------------------------
// laws of recursion
// ---------------------------------------------------------------------------

/**
 * The knobs an epoch law is allowed to turn. Everything here is either a rate
 * parameter or a node-construction option — laws can reshape the recursion,
 * but they cannot reach inside a node that already exists.
 */
export interface Rules {
  e: number;
  k: number;
  cascadeMult: number;
  voidRaw: number;
  /** Multiplier on the endowment a newly opened node is born holding. */
  endowmentMult: number;
  anomalyRate: number;
  bloomDouble: boolean;
  archs: readonly Arch[] | undefined;
  anomalies: readonly Anomaly[] | undefined;
  autoBuy: boolean;
  autoDescend: boolean;
}

export interface EpochLaw {
  id: string;
  name: string;
  blurb: string;
  apply(r: Rules): void;
}

/**
 * Unlocked in this order, one per Epoch. They are deliberately additive and
 * mild: the validated early-game regime (epoch 0, no laws) is untouched.
 */
export const EPOCH_LAWS: EpochLaw[] = [
  {
    id: 'refraction',
    name: 'Law of Refraction',
    blurb: 'Void nodes burn brighter alone — raw output ×2.1 instead of ×1.7.',
    apply: (r) => {
      r.voidRaw = 2.1;
    },
  },
  {
    id: 'grafting',
    name: 'Law of Grafting',
    blurb: 'Bloom anomalies graft two extra generators instead of one.',
    apply: (r) => {
      r.bloomDouble = true;
    },
  },
  {
    id: 'tension',
    name: 'Law of Tension',
    blurb: 'Cascade doors exponentiate harder — ×1.45 on E instead of ×1.3.',
    apply: (r) => {
      r.cascadeMult = 1.45;
    },
  },
  {
    id: 'abundance',
    name: 'Law of Abundance',
    blurb: 'Newly opened nodes are born holding four times the usual endowment.',
    apply: (r) => {
      r.endowmentMult = 4;
    },
  },
  {
    id: 'threshold',
    name: 'Law of Threshold',
    blurb: 'Doors normalise against 10 instead of 12 — every door counts for more.',
    apply: (r) => {
      r.k = 10;
    },
  },
  {
    id: 'aberration',
    name: 'Law of Aberration',
    blurb: 'Anomalies surface in one node out of nine rather than one out of twelve.',
    apply: (r) => {
      r.anomalyRate = 1 / 9;
    },
  },
  {
    id: 'saturation',
    name: 'Law of Saturation',
    blurb: 'The door exponent gains a further +0.03 on top of the per-epoch step.',
    apply: (r) => {
      r.e += 0.03;
    },
  },
  {
    id: 'inheritance',
    name: 'Law of Inheritance',
    blurb: 'Doors normalise against 8, and new nodes are born ten times richer.',
    apply: (r) => {
      r.k = 8;
      r.endowmentMult = 10;
    },
  },
  {
    id: 'plenitude',
    name: 'Law of Plenitude',
    blurb: 'New nodes are born holding twice whatever endowment the other laws already grant.',
    apply: (r) => {
      r.endowmentMult *= 2;
    },
  },
  {
    id: 'proliferation',
    name: 'Law of Proliferation',
    blurb: 'Anomalies surface in one node out of seven.',
    apply: (r) => {
      r.anomalyRate = Math.max(r.anomalyRate, 1 / 7);
    },
  },
  {
    id: 'undertow',
    name: 'Law of Undertow',
    blurb: 'Cascade doors exponentiate still harder — ×1.6 on E.',
    apply: (r) => {
      r.cascadeMult = Math.max(r.cascadeMult, 1.6);
    },
  },
  {
    id: 'solitude',
    name: 'Law of Solitude',
    blurb: 'Void nodes burn at ×2.5 raw when left alone.',
    apply: (r) => {
      r.voidRaw = Math.max(r.voidRaw, 2.5);
    },
  },
  {
    id: 'ascent',
    name: 'Law of Ascent',
    blurb: 'The door exponent gains a further +0.05.',
    apply: (r) => {
      r.e += 0.05;
    },
  },
  {
    id: 'aperture',
    name: 'Law of Aperture',
    blurb: 'Doors normalise against 7 — every child counts for more.',
    apply: (r) => {
      r.k = Math.min(r.k, 7);
    },
  },
  {
    id: 'chorus',
    name: 'Law of Chorus',
    blurb: 'The door exponent gains +0.04, and anomalies become a little more common (1/8).',
    apply: (r) => {
      r.e += 0.04;
      r.anomalyRate = Math.max(r.anomalyRate, 1 / 8);
    },
  },
  {
    id: 'bequest',
    name: 'Law of Bequest',
    blurb: 'New nodes are born twenty times richer, and doors normalise against 6.',
    apply: (r) => {
      r.endowmentMult = Math.max(r.endowmentMult, 20);
      r.k = Math.min(r.k, 6);
    },
  },
];

export function lawById(id: string): EpochLaw | undefined {
  return EPOCH_LAWS.find((l) => l.id === id);
}

/** The next law a player would earn, or undefined once they are all held. */
export function nextLaw(progress: Progress): EpochLaw | undefined {
  return EPOCH_LAWS.find((l) => !progress.laws.includes(l.id));
}

// ---------------------------------------------------------------------------
// derived rules
// ---------------------------------------------------------------------------

/**
 * The door exponent. Epochs raise it a little; Genesis raises it a lot, and
 * is worth more than the epochs it consumes — prestige never moves backwards.
 */
export function baseExponent(progress: Progress): number {
  return BASE_E + EPOCH_E_STEP * progress.epochs + GENESIS_E_STEP * progress.genesis;
}

export function deriveRules(progress: Progress): Rules {
  const r: Rules = {
    e: baseExponent(progress),
    k: K,
    cascadeMult: CASCADE_E_MULT,
    voidRaw: VOID_RAW,
    endowmentMult: 1,
    anomalyRate: ANOMALY_RATE,
    bloomDouble: false,
    archs: undefined,
    anomalies: undefined,
    autoBuy:
      progress.collapses >= AUTOBUY_UNLOCK_COLLAPSES ||
      progress.epochs > 0 ||
      progress.genesis > 0,
    autoDescend: progress.epochs >= AUTODESCEND_UNLOCK_EPOCHS || progress.genesis > 0,
  };
  for (const id of progress.laws) lawById(id)?.apply(r);
  return r;
}

/**
 * Permanent multiplier. Collapses feed it directly; Epoch wipes those and
 * trades them for exponent, which is strictly the better currency long-run.
 */
export function globalMultiplier(progress: Progress, achievementBonus: number): number {
  return 1 + COLLAPSE_MULT_STEP * progress.collapses + achievementBonus;
}

export function rateParams(
  state: GameState,
  achievementBonus: number,
  rules = deriveRules(state.progress),
): RateParams {
  return {
    t: state.run.t,
    globalMult: globalMultiplier(state.progress, achievementBonus),
    e: rules.e,
    voidRaw: rules.voidRaw,
    k: rules.k,
    cascadeMult: rules.cascadeMult,
  };
}

/** Human-readable era tag, stamped onto codex entries at discovery time. */
export function eraLabel(progress: Progress): string {
  return progress.genesis > 0
    ? `G${progress.genesis}·E${progress.epochs}`
    : `E${progress.epochs}`;
}

// ---------------------------------------------------------------------------
// gates
// ---------------------------------------------------------------------------

export function collapseProgress(state: GameState): number {
  const root = state.run.nodes[''];
  return root ? Math.min(1, root.lifetime / GOAL) : 0;
}

export function canCollapse(state: GameState): boolean {
  const root = state.run.nodes[''];
  return !!root && root.lifetime >= GOAL;
}

export function canEpoch(state: GameState): boolean {
  return state.progress.collapses >= COLLAPSES_PER_EPOCH;
}

export function canGenesis(state: GameState): boolean {
  return state.progress.epochs >= EPOCHS_PER_GENESIS;
}

// ---------------------------------------------------------------------------
// transitions
// ---------------------------------------------------------------------------

export interface PrestigeResult {
  kind: 'collapse' | 'epoch' | 'genesis';
  /** Multiplier / exponent after the event, for the ritual to display. */
  headline: string;
  detail: string;
  law?: EpochLaw;
  bankName?: string;
}

function record(state: GameState, entry: HistoryEntry): void {
  state.meta.history.push(entry);
  if (state.meta.history.length > HISTORY_LIMIT) {
    state.meta.history.splice(0, state.meta.history.length - HISTORY_LIMIT);
  }
}

function resetRun(state: GameState, now: number, seed?: number): void {
  const rules = deriveRules(state.progress);
  const bank = bankFor(state.progress);
  state.run = newRun(seed ?? state.run.seed, now, bank, {
    archs: rules.archs,
    anomalies: rules.anomalies,
    bloomDouble: rules.bloomDouble,
  });
}

/**
 * Collapse. The tree goes; the codex stays. Note that nothing in this function
 * touches `state.meta.codex` or `state.meta.feed` — that is the invariant.
 */
export function doCollapse(state: GameState, now: number, achievementBonus: number): PrestigeResult {
  const durationMs = Math.max(0, now - state.run.startedAt);
  const deepest = state.run.deepest;
  const nodes = Object.keys(state.run.nodes).length;

  state.progress.collapses += 1;
  state.meta.stats.totalCollapses += 1;
  if (state.meta.stats.fastestCollapseMs === 0 || durationMs < state.meta.stats.fastestCollapseMs) {
    state.meta.stats.fastestCollapseMs = durationMs;
  }
  record(state, { kind: 'collapse', at: now, durationMs, index: state.progress.collapses, deepest, nodes });

  resetRun(state, now);
  const mult = globalMultiplier(state.progress, achievementBonus);
  return {
    kind: 'collapse',
    headline: `×${mult.toFixed(2)}`,
    detail: `Collapse ${state.progress.collapses}. The tree is gone; what you learned from it is not.`,
  };
}

/**
 * Epoch. Collapses and the multiplier they bought are spent to change the
 * rules themselves: a permanently higher door exponent plus a new law.
 */
export function doEpoch(state: GameState, now: number): PrestigeResult {
  const durationMs = Math.max(0, now - state.run.startedAt);
  const law = nextLaw(state.progress);

  state.progress.epochs += 1;
  state.progress.collapses = 0;
  if (law) state.progress.laws.push(law.id);
  state.meta.stats.totalEpochs += 1;
  record(state, {
    kind: 'epoch',
    at: now,
    durationMs,
    index: state.progress.epochs,
    deepest: state.run.deepest,
    nodes: Object.keys(state.run.nodes).length,
  });

  resetRun(state, now, randomSeed());
  return {
    kind: 'epoch',
    headline: `E = ${baseExponent(state.progress).toFixed(3)}`,
    detail: law
      ? `${law.name}: ${law.blurb}`
      : 'Every law is already yours. The exponent still climbs.',
    law,
  };
}

/**
 * Genesis. Everything numeric resets — including the epochs that bought it —
 * but the exponent it grants exceeds what those epochs were worth, and the
 * language the game names things in is replaced wholesale.
 */
export function doGenesis(state: GameState, now: number): PrestigeResult {
  const durationMs = Math.max(0, now - state.run.startedAt);

  state.progress.genesis += 1;
  state.progress.epochs = 0;
  state.progress.collapses = 0;
  state.progress.laws = [];
  state.progress.bankIndex += 1;
  // The new alphabet is folded out of the player's own history, so no two
  // saves reach the same bank by the same route.
  state.progress.bankSeed = hash(
    `genesis:${state.progress.genesis}:${state.meta.bornAt}:${Math.round(
      state.meta.stats.playtimeMs,
    )}:${state.run.seed}`,
  );
  state.meta.stats.totalGenesis += 1;
  record(state, {
    kind: 'genesis',
    at: now,
    durationMs,
    index: state.progress.genesis,
    deepest: state.run.deepest,
    nodes: Object.keys(state.run.nodes).length,
  });

  resetRun(state, now, randomSeed());
  const bank = bankFor(state.progress);
  return {
    kind: 'genesis',
    headline: `E = ${baseExponent(state.progress).toFixed(3)}`,
    detail: `The recursion is renamed. Everything below now speaks ${bank.name}.`,
    bankName: bank.name,
  };
}

export { GOAL };
