/**
 * flat.ts — the same rate computation as economy.ts, over typed arrays.
 *
 * `computeRates` walks objects, which is fine up to a few thousand nodes. Past
 * that the pointer chasing dominates, and the structure has to be flattened
 * before it can be handed to a worker anyway. `tests/economy.spec.ts` asserts
 * the two implementations agree to floating-point tolerance on random trees —
 * if you change one, change the other.
 *
 * Like `computeRates`, this produces two numbers per node: the amplified
 * output (returned) and the local yield (written into `yieldOut`).
 */

import {
  CASCADE_E_MULT,
  K,
  NUM_CEIL,
  PARASITE_DEBUFF,
  PARASITE_GAIN,
  VOID_RAW,
  clampFinite,
  type RateParams,
  type Tree,
} from './economy';
import { ARCHETYPES, type Arch } from './procgen';

export const ARCH_CODE: Record<Arch, number> = {
  steady: 0,
  pulse: 1,
  decay: 2,
  resonant: 3,
  parasitic: 4,
  cascade: 5,
};

const CODE_STEADY = 0;
const CODE_PULSE = 1;
const CODE_DECAY = 2;
const CODE_RESONANT = 3;
const CODE_PARASITIC = 4;
const CODE_CASCADE = 5;

export interface SimModel {
  /** Node paths, deepest-first — index order for every array below. */
  paths: string[];
  nodeCount: number;
  /** genOff[i]..genOff[i+1] is node i's slice of the generator arrays. */
  genOff: Int32Array;
  isVoid: Uint8Array;
  genArch: Uint8Array;
  genBase: Float64Array;
  genSeed: Float64Array;
  genN: Float64Array;
  /** Child node index behind this generator's door, or -1. */
  genDoor: Int32Array;
}

/** Transferable payload for the worker — same data, no strings. */
export interface SimModelBuffers {
  nodeCount: number;
  genOff: ArrayBuffer;
  isVoid: ArrayBuffer;
  genArch: ArrayBuffer;
  genBase: ArrayBuffer;
  genSeed: ArrayBuffer;
  genN: ArrayBuffer;
  genDoor: ArrayBuffer;
}

export function buildSimModel(tree: Tree): SimModel {
  const { nodes, order } = tree;
  const n = order.length;
  const index = new Map<string, number>();
  for (let i = 0; i < n; i++) index.set(order[i], i);

  let total = 0;
  for (let i = 0; i < n; i++) total += nodes[order[i]].gens.length;

  const genOff = new Int32Array(n + 1);
  const isVoid = new Uint8Array(n);
  const genArch = new Uint8Array(total);
  const genBase = new Float64Array(total);
  const genSeed = new Float64Array(total);
  const genN = new Float64Array(total);
  const genDoor = new Int32Array(total);

  let g = 0;
  for (let i = 0; i < n; i++) {
    genOff[i] = g;
    const node = nodes[order[i]];
    isVoid[i] = node.anomaly === 'void' ? 1 : 0;
    for (const gen of node.gens) {
      genArch[g] = ARCH_CODE[gen.arch] ?? 0;
      genBase[g] = gen.base;
      genSeed[g] = gen.seed >>> 0;
      genN[g] = gen.n;
      const child = gen.door === null ? undefined : index.get(gen.door);
      genDoor[g] = child === undefined ? -1 : child;
      g++;
    }
  }
  genOff[n] = g;

  return { paths: order.slice(), nodeCount: n, genOff, isVoid, genArch, genBase, genSeed, genN, genDoor };
}

export function toBuffers(m: SimModel): { payload: SimModelBuffers; transfer: ArrayBuffer[] } {
  const payload: SimModelBuffers = {
    nodeCount: m.nodeCount,
    genOff: m.genOff.buffer as ArrayBuffer,
    isVoid: m.isVoid.buffer as ArrayBuffer,
    genArch: m.genArch.buffer as ArrayBuffer,
    genBase: m.genBase.buffer as ArrayBuffer,
    genSeed: m.genSeed.buffer as ArrayBuffer,
    genN: m.genN.buffer as ArrayBuffer,
    genDoor: m.genDoor.buffer as ArrayBuffer,
  };
  return {
    payload,
    transfer: [
      payload.genOff,
      payload.isVoid,
      payload.genArch,
      payload.genBase,
      payload.genSeed,
      payload.genN,
      payload.genDoor,
    ],
  };
}

export function fromBuffers(b: SimModelBuffers): SimModel {
  return {
    paths: [],
    nodeCount: b.nodeCount,
    genOff: new Int32Array(b.genOff),
    isVoid: new Uint8Array(b.isVoid),
    genArch: new Uint8Array(b.genArch),
    genBase: new Float64Array(b.genBase),
    genSeed: new Float64Array(b.genSeed),
    genN: new Float64Array(b.genN),
    genDoor: new Int32Array(b.genDoor),
  };
}

/**
 * Bottom-up single pass. Children always precede parents in index order
 * (the order is sorted deepest-first), so `out[child]` is always already
 * final by the time a parent reads it.
 */
export function computeRatesFlat(
  m: SimModel,
  p: RateParams,
  out: Float64Array = new Float64Array(m.nodeCount),
  yieldOut: Float64Array = new Float64Array(m.nodeCount),
): Float64Array {
  const voidRaw = p.voidRaw ?? VOID_RAW;
  const k = p.k ?? K;
  const cascadeMult = p.cascadeMult ?? CASCADE_E_MULT;
  const e = p.e;
  const t = p.t;
  const gm = p.globalMult;

  const { genOff, isVoid, genArch, genBase, genSeed, genN, genDoor, nodeCount } = m;
  // scratch, reused across nodes; nodes never have more than a handful of gens
  const debuff = new Float64Array(16);

  for (let i = 0; i < nodeCount; i++) {
    const s = genOff[i];
    const eIdx = genOff[i + 1];
    const count = eIdx - s;

    // parasitic debuffs, wrapping within the node
    for (let j = 0; j < count; j++) debuff[j] = 1;
    if (count > 1) {
      for (let j = 0; j < count; j++) {
        if (genArch[s + j] === CODE_PARASITIC) {
          debuff[(j + 1) % count] *= PARASITE_DEBUFF;
        }
      }
    }

    let live = 0;
    for (let j = 0; j < count; j++) if (genN[s + j] > 0) live++;

    let raw = 0;
    for (let j = 0; j < count; j++) {
      const gi = s + j;
      const n = genN[gi];
      if (n <= 0) continue;
      const flat = n * genBase[gi] * debuff[j];
      switch (genArch[gi]) {
        case CODE_STEADY:
        case CODE_CASCADE:
          raw += flat;
          break;
        case CODE_PULSE: {
          const seed = genSeed[gi];
          const freq = 0.28 + (seed % 5) * 0.08;
          raw += flat * (1 + 0.5 * Math.sin(t * freq + (seed % 7)));
          break;
        }
        case CODE_DECAY:
          raw += flat / (1 + 0.012 * n);
          break;
        case CODE_RESONANT:
          raw += flat * (1 + Math.log10(1 + (live - 1)) / 5);
          break;
        case CODE_PARASITIC:
          raw += flat * PARASITE_GAIN;
          break;
        default:
          raw += flat;
      }
    }
    raw = clampFinite(raw);

    let doors = 1;
    if (isVoid[i]) {
      raw *= voidRaw;
    } else {
      for (let j = 0; j < count; j++) {
        const child = genDoor[s + j];
        if (child < 0) continue;
        const cr = out[child];
        if (!(cr > 0)) continue;
        const exp = genArch[s + j] === CODE_CASCADE ? e * cascadeMult : e;
        doors *= clampFinite(1 + Math.pow(cr / k, exp));
        if (doors > NUM_CEIL) {
          doors = NUM_CEIL;
          break;
        }
      }
    }
    const y = clampFinite(raw * gm);
    yieldOut[i] = y;
    out[i] = clampFinite(y * doors);
  }
  return out;
}

export function archFromCode(code: number): Arch {
  return ARCHETYPES[code] ?? 'steady';
}
