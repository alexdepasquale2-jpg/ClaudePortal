/**
 * Reusable object pool.
 *
 * This exists because the top-down view is a Survivors spine: projectiles and Goliaths spawn by the
 * hundred, and on a mid-range phone a GC pause is visible as a stutter. STYLE-GUIDE.md forbids
 * allocation in per-frame hot paths; this is how that rule is kept.
 */
export class ObjectPool<T> {
  private readonly available: T[] = [];
  private liveCount = 0;

  constructor(
    private readonly create: () => T,
    private readonly reset: (item: T) => void,
    prewarm = 0,
  ) {
    for (let i = 0; i < prewarm; i++) this.available.push(create());
  }

  /** Number of objects currently checked out. Watch this in a profiler, not in gameplay logic. */
  get inUse(): number {
    return this.liveCount;
  }

  get idle(): number {
    return this.available.length;
  }

  acquire(): T {
    this.liveCount++;
    const recycled = this.available.pop();
    return recycled ?? this.create();
  }

  release(item: T): void {
    this.reset(item);
    this.liveCount = Math.max(0, this.liveCount - 1);
    this.available.push(item);
  }

  /** Drop idle objects. Call between scenes, never during a run. */
  clear(): void {
    this.available.length = 0;
  }
}
