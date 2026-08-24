import type { EventBus } from '@core/events/EventBus';
import type { MaterialCounts, NodeId } from '@core/types/Vocabulary';

/**
 * Installing Pyron Chrome on a primary node.
 *
 * Chrome is found, never forged — so installing it spends a material the player cannot replace by
 * producing more. That irreversibility is the point: choosing WHICH node to protect is a
 * campaign-level decision made inside a run.
 *
 * Installation itself is loud, which is the small joke at the heart of it: protecting a node from
 * being heard requires being heard.
 */
export class ChromeInstaller {
  constructor(private readonly events: EventBus) {}

  /** Whether the player has chrome and the node is an unprotected primary. */
  canInstall(_nodeId: NodeId, _available: MaterialCounts): boolean {
    // TODO: implement per DESIGN.md
    throw new Error('ChromeInstaller.canInstall not implemented');
  }

  /** Spend the chrome and protect the node. Not reversible; chrome is not recovered by scrapping. */
  install(_nodeId: NodeId): void {
    // TODO: implement per DESIGN.md — deduct one unit of PyronChrome, mark the node chromed,
    // re-register its noise emitter at the reduced signature, emit a noise impulse for the work
    // itself, and emit 'node/chromeInstalled'.
    void this.events;
    throw new Error('ChromeInstaller.install not implemented');
  }
}
