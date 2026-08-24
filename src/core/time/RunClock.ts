/**
 * The one loop.
 *
 * Fixed simulation step, variable render step. Systems register explicitly — no hidden discovery,
 * no module-level side effects (STYLE-GUIDE.md). A run's elapsed time is authoritative here and
 * nowhere else, because feats, production ticks and Sancient scheduling all read from it and must
 * agree.
 *
 * Pausing stops simulation but not rendering: a paused run must still draw, or the menu layered
 * over it has nothing behind it.
 */

export interface Updatable {
  update(dt: number): void;
}

export interface Renderable {
  render(alpha: number): void;
}

export const FIXED_STEP_SECONDS = 1 / 60;
/** Never simulate more than this much in one frame — a backgrounded tab must not spiral. */
const MAX_FRAME_SECONDS = 0.25;

export class RunClock {
  private readonly simulated: Updatable[] = [];
  private readonly rendered: Renderable[] = [];

  private accumulator = 0;
  private lastFrameMs = 0;
  private rafHandle: number | null = null;

  private elapsedSeconds = 0;
  private paused = false;

  /** Seconds of simulated time since the run started. Excludes paused time. */
  get elapsed(): number {
    return this.elapsedSeconds;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isRunning(): boolean {
    return this.rafHandle !== null;
  }

  addSystem(system: Updatable): () => void {
    this.simulated.push(system);
    return () => {
      const index = this.simulated.indexOf(system);
      if (index >= 0) this.simulated.splice(index, 1);
    };
  }

  addRenderer(renderer: Renderable): () => void {
    this.rendered.push(renderer);
    return () => {
      const index = this.rendered.indexOf(renderer);
      if (index >= 0) this.rendered.splice(index, 1);
    };
  }

  start(): void {
    if (this.rafHandle !== null) return;
    this.lastFrameMs = performance.now();
    this.accumulator = 0;
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.rafHandle === null) return;
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    // Discard the gap so resuming does not simulate the time spent in a menu.
    this.lastFrameMs = performance.now();
    this.accumulator = 0;
  }

  /** Drop all systems and reset elapsed time. Between runs only. */
  reset(): void {
    this.stop();
    this.simulated.length = 0;
    this.rendered.length = 0;
    this.elapsedSeconds = 0;
    this.accumulator = 0;
    this.paused = false;
  }

  private readonly frame = (nowMs: number): void => {
    this.rafHandle = requestAnimationFrame(this.frame);

    const frameSeconds = Math.min((nowMs - this.lastFrameMs) / 1000, MAX_FRAME_SECONDS);
    this.lastFrameMs = nowMs;

    if (!this.paused) {
      this.accumulator += frameSeconds;
      while (this.accumulator >= FIXED_STEP_SECONDS) {
        for (const system of this.simulated) system.update(FIXED_STEP_SECONDS);
        this.elapsedSeconds += FIXED_STEP_SECONDS;
        this.accumulator -= FIXED_STEP_SECONDS;
      }
    }

    const alpha = this.accumulator / FIXED_STEP_SECONDS;
    for (const renderer of this.rendered) renderer.render(alpha);
  };
}
