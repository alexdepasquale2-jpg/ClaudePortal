import type { NodeId, NobotGroupId } from '@core/types/Vocabulary';

/**
 * A node planted to be taken.
 *
 * Post-betrayal Nobots want their own protected nodes. A trojan node is the player using that
 * appetite: plant one somewhere expensive to hold, let them take it, and let them deal with what
 * comes when it starts making noise.
 *
 * It is the Subversive flavour tag's clearest expression, and it works precisely because the noise
 * rules apply to everyone. A node a betrayed group is holding is a node summoning Sancients toward
 * them rather than toward you.
 */
export interface TrojanNodeState {
  readonly nodeId: NodeId;
  /** Group the node is baited at. */
  readonly baitedAt: NobotGroupId;
  /** Whether they have taken it. */
  readonly claimed: boolean;
  /** Campaign tick at which it was claimed. */
  readonly claimedAtTick: number | null;
}

export class TrojanNode {
  /** Whether a group would find this node worth taking. */
  static isAttractiveTo(_groupId: NobotGroupId, _nodeId: NodeId): boolean {
    // TODO: implement per DESIGN.md — attractiveness rises with the node's production and falls
    // with how well defended it is. A node they cannot take is not bait.
    throw new Error('TrojanNode.isAttractiveTo not implemented');
  }

  /** Hand the node over. The group now owns its noise, and everything that noise attracts. */
  static claim(_state: TrojanNodeState, _tick: number): TrojanNodeState {
    // TODO: implement per DESIGN.md
    throw new Error('TrojanNode.claim not implemented');
  }
}
