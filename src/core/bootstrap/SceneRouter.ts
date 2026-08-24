/**
 * Holds exactly one active scene.
 *
 * DESIGN.md is explicit: "Never load the entire archipelago as one physics scene. One operation =
 * one scene." This class is where that rule lives. It cannot hold two scenes at once, so the
 * archipelago cannot become a live world by accident.
 *
 * World and Region are menu layers over campaign data — they render a map, not a simulation. Only
 * OperationScene instantiates a live site.
 */

export interface Scene {
  readonly name: string;
  load(): Promise<void> | void;
  unload(): Promise<void> | void;
}

export type SceneFactory = () => Scene;

export class SceneRouter {
  private readonly factories = new Map<string, SceneFactory>();
  private current: Scene | null = null;
  private transitioning = false;

  get activeScene(): Scene | null {
    return this.current;
  }

  register(name: string, factory: SceneFactory): void {
    this.factories.set(name, factory);
  }

  /** Unload the current scene fully, then load the next. Never overlaps. */
  async goto(name: string): Promise<void> {
    if (this.transitioning) {
      throw new Error(`SceneRouter is already transitioning; refused goto("${name}")`);
    }
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`No scene registered under "${name}"`);

    this.transitioning = true;
    try {
      if (this.current) {
        await this.current.unload();
        this.current = null;
      }
      const next = factory();
      await next.load();
      this.current = next;
    } finally {
      this.transitioning = false;
    }
  }

  async unloadCurrent(): Promise<void> {
    if (!this.current) return;
    await this.current.unload();
    this.current = null;
  }

  get registeredScenes(): readonly string[] {
    return [...this.factories.keys()];
  }
}
