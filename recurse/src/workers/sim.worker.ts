/**
 * sim.worker.ts — rate computation off the main thread.
 *
 * The worker owns no game state. It holds a mirror of the tree's *shape*
 * (rebuilt whenever a door opens or a run resets) and a mirror of the
 * generator counts (patched on every purchase), and it answers one question:
 * given these parameters, what is every node's rate? Currency integration
 * stays on the main thread, so the worker can never drift from the save.
 */

import { computeRatesFlat, fromBuffers, type SimModel, type SimModelBuffers } from '../engine/flat';
import type { RateParams } from '../engine/economy';

export interface InitMsg {
  cmd: 'init';
  model: SimModelBuffers;
}
/** Purchases: paired arrays of flat generator index -> new count. */
export interface CountsMsg {
  cmd: 'counts';
  idx: ArrayBuffer;
  val: ArrayBuffer;
}
export interface TickMsg {
  cmd: 'tick';
  id: number;
  params: RateParams;
}
export type SimRequest = InitMsg | CountsMsg | TickMsg;

export interface RatesMsg {
  type: 'rates';
  id: number;
  rates: ArrayBuffer;
  yields: ArrayBuffer;
  nodeCount: number;
}
export interface ReadyMsg {
  type: 'ready';
  nodeCount: number;
}
export type SimResponse = RatesMsg | ReadyMsg;

let model: SimModel | null = null;
let scratch: Float64Array | null = null;
let yieldScratch: Float64Array | null = null;

self.onmessage = (ev: MessageEvent<SimRequest>) => {
  const msg = ev.data;
  switch (msg.cmd) {
    case 'init': {
      model = fromBuffers(msg.model);
      scratch = new Float64Array(model.nodeCount);
      yieldScratch = new Float64Array(model.nodeCount);
      const ready: ReadyMsg = { type: 'ready', nodeCount: model.nodeCount };
      (self as unknown as Worker).postMessage(ready);
      break;
    }
    case 'counts': {
      if (!model) break;
      const idx = new Int32Array(msg.idx);
      const val = new Float64Array(msg.val);
      for (let i = 0; i < idx.length; i++) {
        const g = idx[i];
        if (g >= 0 && g < model.genN.length) model.genN[g] = val[i];
      }
      break;
    }
    case 'tick': {
      if (!model || !scratch || !yieldScratch) break;
      computeRatesFlat(model, msg.params, scratch, yieldScratch);
      // copy out so the worker keeps its own scratch across ticks
      const rates = scratch.slice().buffer;
      const yields = yieldScratch.slice().buffer;
      const out: RatesMsg = {
        type: 'rates',
        id: msg.id,
        rates,
        yields,
        nodeCount: model.nodeCount,
      };
      (self as unknown as Worker).postMessage(out, [rates, yields]);
      break;
    }
  }
};
