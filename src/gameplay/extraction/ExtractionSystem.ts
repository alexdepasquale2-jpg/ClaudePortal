import type { EventBus } from '@core/events/EventBus';
import type { Updatable } from '@core/time/RunClock';
import type { MaterialCounts, RunEndType } from '@core/types/Vocabulary';
import type { RunResult } from '@campaign/RunResult';

/**
 * Resolves the run.
 *
 * This is the boundary between session and campaign. Everything a run did becomes a RunResult here,
 * and that RunResult is the ONLY thing that crosses (ARCHITECTURE.md).
 *
 * The three end types are not variations on the same outcome:
 *
 *  - Extracted: the backpack survives. Materials reach the campaign stockpile.
 *  - Died: the backpack does NOT survive. Everything consumed is still consumed. The site may flip
 *    away from you. This is the expensive one, and it is supposed to be.
 *  - Abandoned: you walked out early. Nothing extracted, but a node left lit is still lit — and
 *    still producing, for whoever finds it.
 *
 * All three write to the graph. There is no end type that leaves the battlefield unchanged; that is
 * the core concept, and this class is where it is enforced.
 */
export class ExtractionSystem implements Updatable {
  private holdProgress = 0;

  constructor(private readonly events: EventBus) {}

  get progress(): number {
    return this.holdProgress;
  }

  /** Assemble the RunResult. The single crossing point from run to campaign. */
  resolve(_endType: RunEndType, _extracted: MaterialCounts): RunResult {
    // TODO: implement per DESIGN.md
    //  - Died and Abandoned extract nothing, whatever the backpack held
    //  - consumed materials count regardless of end type
    //  - lit and chromed nodes are carried across; they keep producing for the site's holder
    //  - metrics are handed to FeatEvaluator on the track matching this end type
    //  - emit 'run/resolved'; the fort is torn down immediately afterwards and never serialised
    void this.events;
    throw new Error('ExtractionSystem.resolve not implemented');
  }

  update(_dt: number): void {
    // TODO: implement per DESIGN.md — advance the hold while the player is inside an available
    // zone, reset it when they leave or the zone is contested.
    void this.holdProgress;
    throw new Error('ExtractionSystem.update not implemented');
  }
}
