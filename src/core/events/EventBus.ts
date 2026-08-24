import type { GameEventMap, GameEventName, GameEventPayload } from './GameEvents';

export type Unsubscribe = () => void;
export type Handler<K extends GameEventName> = (payload: GameEventPayload<K>) => void;

/**
 * Typed publish/subscribe.
 *
 * Implemented for real rather than stubbed: it is the seam every other system talks through, so
 * scaffolded modules can be wired together and observed in tests before any of them do their work.
 *
 * Deliberately synchronous. A run's causality matters — noise from solidifying must reach the
 * Sancient director within the same tick that produced it, or the Dread pillar's cause and effect
 * come apart.
 */
export class EventBus {
  private readonly handlers = new Map<GameEventName, Set<Handler<GameEventName>>>();

  on<K extends GameEventName>(event: K, handler: Handler<K>): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<GameEventName>);
    return () => {
      set?.delete(handler as Handler<GameEventName>);
    };
  }

  once<K extends GameEventName>(event: K, handler: Handler<K>): Unsubscribe {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  emit<K extends GameEventName>(event: K, payload: GameEventPayload<K>): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    // Copy: a handler may subscribe or unsubscribe while this event is being delivered.
    for (const handler of [...set]) {
      try {
        (handler as Handler<K>)(payload);
      } catch (error) {
        // One broken listener must not abort a run mid-tick.
        console.error(`[EventBus] handler for "${String(event)}" threw:`, error);
      }
    }
  }

  /** Drop every subscription. Call when tearing down a scene, never mid-run. */
  clear(): void {
    this.handlers.clear();
  }

  listenerCount(event: GameEventName): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

/** The application-wide bus. Scenes may create their own for run-scoped traffic. */
export const gameEvents = new EventBus();

export type { GameEventMap };
