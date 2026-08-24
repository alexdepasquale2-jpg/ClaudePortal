import type { NodeId } from '@core/types/Vocabulary';

/**
 * The player's own use of a lit node's signal.
 *
 * Sancients jack Goliaths. The player, standing at their own lit node, can reach into the network
 * the node is projecting — reading what is nearby, or briefly borrowing a machine's attention.
 *
 * The symmetry is the point: it is the same mechanism used against you, at a much smaller scale,
 * and it only works where you have already made the dangerous decision to light up. Every use costs
 * signal, and spending signal makes the node louder — so using your own network is another way of
 * being heard.
 */
export interface JackTarget {
  readonly id: string;
  readonly kind: 'goliath' | 'nobot-group' | 'node';
  readonly distance: number;
}

export class PlayerJackController {
  private available = 0;

  /** Signal accrues while standing within a lit node's radius. */
  get signal(): number {
    return this.available;
  }

  /** What the player could reach from a given node. */
  targetsFrom(_nodeId: NodeId): readonly JackTarget[] {
    // TODO: implement per DESIGN.md — only within the lit node's radius; a dark node reaches nothing.
    throw new Error('PlayerJackController.targetsFrom not implemented');
  }

  /** Borrow a machine's attention briefly. Spends signal and raises the node's loudness. */
  jack(_targetId: string, _durationSeconds: number): void {
    // TODO: implement per DESIGN.md — the player's jack is short and cannot be made permanent;
    // permanent floors belong to Sancients (ADR-0003) and must stay theirs.
    throw new Error('PlayerJackController.jack not implemented');
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — accrue signal near lit nodes, expire active jacks.
    void this.available;
    throw new Error('PlayerJackController.update not implemented');
  }
}
