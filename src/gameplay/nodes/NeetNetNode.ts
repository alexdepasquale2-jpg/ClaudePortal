import type { MaterialCounts, NodeId, Vec3 } from '@core/types/Vocabulary';

/**
 * A NeetNetNode. The object the whole Dread pillar is built around.
 *
 * DESIGN.md: "Underground, machine signal is dead until you plant a NeetNetNode (NNN). Lighting an
 * NNN is always a deliberate, dangerous decision."
 *
 * Planting is quiet and cheap. LIGHTING is the decision: it starts production, it starts the noise,
 * and it tells everything nearby that the signal is back. A planted, unlit node does nothing and
 * costs nothing — which is exactly what makes the choice to light it a choice.
 *
 * A `primary` node is the one that can carry Pyron Chrome. Only primaries can be protected, which
 * is what makes chrome a decision about which node matters rather than a blanket upgrade.
 */
export interface NeetNetNode {
  readonly id: NodeId;
  readonly position: Vec3;
  /** Planted but dark. Signal is still dead. */
  readonly planted: boolean;
  /** Lit. Signal is up, production is running, and everything can hear it. */
  readonly lit: boolean;
  /** Only a primary node may carry Pyron Chrome. */
  readonly primary: boolean;
  readonly chromed: boolean;
  /** Noise this node emits per second while lit, before any chrome reduction. */
  readonly baseLoudness: number;
  /** Production per campaign tick, inherited by whoever ends up holding the site. */
  readonly production: MaterialCounts;
  readonly health: number;
  readonly maxHealth: number;
}

/** Effective noise, after chrome. This is the only place chrome changes the maths. */
export function effectiveLoudness(node: NeetNetNode, chromeMultiplier: number): number {
  if (!node.lit) return 0;
  return node.chromed ? node.baseLoudness * chromeMultiplier : node.baseLoudness;
}
