import type { CardEffectRunner } from './CardEffectRunner';
import type { CardManager } from './CardManager';

/**
 * Guarantees cards always reset.
 *
 * A tiny class for a rule that would otherwise be spread across three places and eventually get
 * missed on one code path. DESIGN.md says "In-run VS-style cards ALWAYS reset" — always meaning on
 * every end type, including abandonment, including a crash-and-reload, including the path nobody
 * remembered to write.
 *
 * Reset happens on run START as well as run END. Ending is the intent; starting is the safety net
 * for any path that skipped the end.
 */
export class CardResetService {
  constructor(
    private readonly manager: CardManager,
    private readonly effects: CardEffectRunner,
  ) {}

  /** Safety net: whatever happened last run, this run starts clean. */
  onRunStarted(): void {
    this.resetAll();
  }

  /** Intent: the run is over, the cards go with it. Every end type, no exceptions. */
  onRunResolved(): void {
    this.resetAll();
  }

  private resetAll(): void {
    this.manager.reset();
    this.effects.reset();
  }
}
