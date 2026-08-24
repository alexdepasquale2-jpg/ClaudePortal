import { EventBus, gameEvents } from '../events/EventBus';
import { RunClock } from '../time/RunClock';
import { probeCapabilities, type Capabilities } from './Capabilities';
import { SceneRouter } from './SceneRouter';
import { ServiceLocator, serviceToken, services } from './ServiceLocator';

/**
 * Composition root.
 *
 * Builds the services every layer shares, registers the scenes, and hands control to the Boot
 * scene. Nothing else in the codebase may construct these — a second EventBus or a second RunClock
 * is a bug that presents as "events sometimes don't arrive".
 *
 * ARCHITECTURE.md: scenes are the only place a live run and the campaign menus meet, and only by
 * handing a RunResult from one to the other. Bootstrap wires that seam; it does not cross it.
 */

export const TOKENS = {
  events: serviceToken<EventBus>('EventBus'),
  clock: serviceToken<RunClock>('RunClock'),
  router: serviceToken<SceneRouter>('SceneRouter'),
  capabilities: serviceToken<Capabilities>('Capabilities'),
} as const;

export interface BootstrapOptions {
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLElement;
  /** Scene to enter once services are up. Defaults to 'Boot'. */
  readonly entryScene?: string;
}

export class GameBootstrap {
  readonly locator: ServiceLocator = services;
  readonly events: EventBus = gameEvents;
  readonly clock = new RunClock();
  readonly router = new SceneRouter();
  readonly capabilities: Capabilities = probeCapabilities();

  constructor(private readonly options: BootstrapOptions) {}

  get canvas(): HTMLCanvasElement {
    return this.options.canvas;
  }

  get overlay(): HTMLElement {
    return this.options.overlay;
  }

  /** Register shared services. Safe to call once. */
  registerServices(): void {
    this.locator.register(TOKENS.events, this.events);
    this.locator.register(TOKENS.clock, this.clock);
    this.locator.register(TOKENS.router, this.router);
    this.locator.register(TOKENS.capabilities, this.capabilities);
  }

  /**
   * Register every scene factory with the router.
   *
   * Called by src/main.ts, which is the only module allowed to import both core and scenes — see
   * the `app` layer rule in eslint.config.js.
   */
  registerScenes(scenes: Readonly<Record<string, () => import('./SceneRouter').Scene>>): void {
    for (const [name, factory] of Object.entries(scenes)) {
      this.router.register(name, factory);
    }
  }

  async start(): Promise<void> {
    if (this.capabilities.webglVersion === null) {
      throw new Error('SkyNeet Survivors requires WebGL. No WebGL context is available.');
    }
    await this.router.goto(this.options.entryScene ?? 'Boot');
    this.clock.start();
  }

  async shutdown(): Promise<void> {
    this.clock.stop();
    await this.router.unloadCurrent();
    this.events.clear();
    this.locator.clear();
  }
}
