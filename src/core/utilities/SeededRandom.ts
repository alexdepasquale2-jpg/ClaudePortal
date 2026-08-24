/**
 * Deterministic pseudo-random source.
 *
 * This is implemented for real, not stubbed, because determinism is a prerequisite rather than a
 * feature. Site generation, card draws and Sancient scheduling all take a SeededRandom; a run must
 * be reproducible from (campaignSeed, siteId, runIndex) or SeededGeneration means nothing and no
 * leaderboard claim can ever be checked.
 *
 * STYLE-GUIDE.md: never call Math.random() in gameplay or campaign code. Take one of these.
 *
 * Algorithm is mulberry32 — small, fast, adequate for a game, and its entire state is one uint32,
 * so it serialises into a save with no ceremony.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Derive a named child stream. Same parent + same name always yields the same stream. */
  static derive(parentSeed: number, label: string): SeededRandom {
    return new SeededRandom(hashString(label, parentSeed));
  }

  /** Current internal state — serialise this to resume an identical stream later. */
  get seed(): number {
    return this.state;
  }

  /** Float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Uniform pick. Throws on an empty array rather than returning undefined. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('SeededRandom.pick called with an empty array');
    const chosen = items[this.int(0, items.length - 1)];
    if (chosen === undefined) throw new Error('SeededRandom.pick produced an out-of-range index');
    return chosen;
  }

  /** Weighted pick. Weights need not sum to 1; non-positive weights are skipped. */
  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    let total = 0;
    for (const item of items) {
      const weight = weightOf(item);
      if (weight > 0) total += weight;
    }
    if (total <= 0) throw new Error('SeededRandom.pickWeighted called with no positive weights');

    let roll = this.next() * total;
    for (const item of items) {
      const weight = weightOf(item);
      if (weight <= 0) continue;
      roll -= weight;
      if (roll <= 0) return item;
    }
    // Floating-point drift only; the last positive-weight item is the correct answer.
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item !== undefined && weightOf(item) > 0) return item;
    }
    throw new Error('SeededRandom.pickWeighted failed to select an item');
  }

  /** In-place Fisher-Yates. Returns the same array for convenience. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = items[i] as T;
      const b = items[j] as T;
      items[i] = b;
      items[j] = a;
    }
    return items;
  }

  /** A fresh generator at the current state — branch without disturbing this stream. */
  fork(label: string): SeededRandom {
    return SeededRandom.derive(this.state, label);
  }
}

/** FNV-1a, so a string label deterministically becomes a seed. */
export function hashString(text: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
