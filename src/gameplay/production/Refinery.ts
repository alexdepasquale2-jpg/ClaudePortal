import type { MaterialCounts, MaterialTier, NodeId } from '@core/types/Vocabulary';

/**
 * Converts raw material into higher tiers, at a site, while a node is lit.
 *
 * A refinery only runs on signal — no lit NNN, no production. That dependency is what ties the
 * Greed pillar to the Dread one: the way to get more is to stay lit, and staying lit is the thing
 * that gets you killed.
 *
 * A running refinery is also a continuous noise emitter. Production is never quiet.
 */
export interface RefineryConfig {
  readonly id: string;
  readonly nodeId: NodeId;
  /** What it consumes per cycle. */
  readonly input: MaterialCounts;
  /** What it produces per cycle. */
  readonly output: MaterialCounts;
  readonly cycleSeconds: number;
  /** Continuous loudness while running. */
  readonly loudness: number;
}

export class Refinery {
  private progress = 0;
  private running = false;

  constructor(readonly config: RefineryConfig) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Refineries only run while their node is lit. Nothing else may start one. */
  setNodeLit(lit: boolean): void {
    this.running = lit;
    if (!lit) this.progress = 0;
  }

  /** Whether the local stockpile can feed another cycle. */
  canCycle(_available: MaterialCounts): boolean {
    // TODO: implement per DESIGN.md
    throw new Error('Refinery.canCycle not implemented');
  }

  update(_dt: number): MaterialCounts | null {
    // TODO: implement per DESIGN.md — advance progress while running and fed; on cycle completion
    // consume input, return output, and reset. Return null when nothing completed this tick.
    void this.progress;
    throw new Error('Refinery.update not implemented');
  }

  /** Pyron Chrome is never an output. It is found, never forged (DESIGN.md). */
  static isValidOutput(tier: MaterialTier): boolean {
    return tier !== 'PyronChrome';
  }
}
