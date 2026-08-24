import type { EventBus } from '@core/events/EventBus';
import type { NoiseSystem } from '@core/noise/NoiseSystem';
import type { NodeId } from '@core/types/Vocabulary';

/**
 * Lighting a node.
 *
 * "Should we turn on NNN?" is the sentence the Dread pillar is named after, and this class is the
 * moment it is answered. Lighting must be:
 *
 *  - deliberate: confirmed, never a mis-click, never a passive consequence of walking past
 *  - dangerous: it registers a continuous NoiseEmitter that runs until the node is extinguished,
 *    destroyed, or the run ends
 *  - worth it: it starts production, and production is what the campaign inherits
 *
 * Extinguishing is possible but does not undo the loudness already accumulated. You can stop making
 * noise; you cannot unmake it.
 */
export class NNNActivation {
  constructor(
    private readonly events: EventBus,
    private readonly noise: NoiseSystem,
  ) {}

  /** Plant a node. Quiet, cheap, and reversible — this is not the decision. */
  plant(_nodeId: NodeId, _position: { x: number; y: number; z: number }, _primary: boolean): void {
    // TODO: implement per DESIGN.md — emit 'node/planted'. No noise emitter yet.
    void this.events;
    throw new Error('NNNActivation.plant not implemented');
  }

  /**
   * Light a node. THE decision.
   * Requires explicit confirmation from the caller — never call this from a proximity trigger.
   */
  light(_nodeId: NodeId): void {
    // TODO: implement per DESIGN.md — register a continuous NoiseEmitter whose loudness is
    // effectiveLoudness(node, chromeMultiplier), start production, emit 'node/lit'.
    void this.noise;
    throw new Error('NNNActivation.light not implemented');
  }

  /** Go dark. Stops new noise; does not remove loudness already accumulated. */
  extinguish(_nodeId: NodeId, _reason: 'player' | 'destroyed' | 'runEnd'): void {
    // TODO: implement per DESIGN.md
    throw new Error('NNNActivation.extinguish not implemented');
  }

  /** Nodes still lit when the run ends. These persist into the campaign and keep producing. */
  litAtRunEnd(): readonly NodeId[] {
    // TODO: implement per DESIGN.md
    throw new Error('NNNActivation.litAtRunEnd not implemented');
  }
}
