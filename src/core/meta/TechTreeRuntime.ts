import type { TechNode } from '../data/tech/TechTree';
import type { MaterialCounts } from '../types/Vocabulary';
import type { UnlockGate } from './UnlockGate';

/**
 * The player's position in the one permanent tech tree.
 *
 * Tech persists — unlike cards, which always reset. That difference is the whole progression
 * design in one sentence, and this class is the persistent half.
 *
 * Purchasing spends from the CAMPAIGN stockpile, not from a run's backpack, so a run's haul only
 * becomes progression after it survives extraction. That is the Greed pillar's payoff and its risk
 * in the same mechanism.
 */
export interface TechPurchase {
  readonly nodeId: string;
  readonly spent: MaterialCounts;
}

export class TechTreeRuntime {
  private readonly unlocked = new Set<string>();

  constructor(
    private readonly nodes: readonly TechNode[],
    private readonly gate: UnlockGate,
  ) {}

  get unlockedIds(): ReadonlySet<string> {
    return this.unlocked;
  }

  isUnlocked(nodeId: string): boolean {
    return this.unlocked.has(nodeId);
  }

  /** Nodes whose tech prerequisites are met — what the Technology menu draws as reachable. */
  available(): readonly TechNode[] {
    return this.nodes.filter(
      (node) =>
        !this.unlocked.has(node.id) &&
        node.requires.every((requirement) => this.unlocked.has(requirement)),
    );
  }

  /** Spend and unlock. Throws rather than silently no-op'ing if the gate refuses. */
  purchase(
    _nodeId: string,
    _earnedFeats: ReadonlySet<string>,
    _stockpile: MaterialCounts,
  ): TechPurchase {
    // TODO: implement per DESIGN.md — consult the gate, deduct cost, record the unlock.
    void this.gate;
    throw new Error('TechTreeRuntime.purchase not implemented');
  }

  restore(unlockedIds: readonly string[]): void {
    this.unlocked.clear();
    for (const id of unlockedIds) this.unlocked.add(id);
  }

  /** Camera presets granted by unlocked tech — how views reach parity late. */
  unlockedCameraPresets(): readonly string[] {
    return this.nodes
      .filter((node) => node.category === 'camera-preset' && this.unlocked.has(node.id))
      .map((node) => node.id);
  }
}
