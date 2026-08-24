import type { ExtractionZone } from './ExtractionZone';

/**
 * The last decision of every run.
 *
 * You are standing at the exit with a full backpack and a lit node behind you. Leaving banks the
 * haul and abandons the node. Staying keeps the node producing and risks everything you are
 * carrying.
 *
 * Every pillar meets here: Greed says stay, Dread says the loudness is still rising, Power says the
 * fort will hold, Panic says a Sancient is already inside it, and Consequence says whichever you
 * choose will be on the map next time.
 *
 * This class exists to give the HUD the numbers that decision needs. It does not make the decision
 * and must never make it for the player — no auto-extract, no timer that forces a choice.
 */
export interface DecisionContext {
  /** What is in the backpack, valued in campaign terms. */
  readonly carriedValue: number;
  /** Production per campaign tick that leaving would hand over. */
  readonly productionAtRisk: number;
  /** Current accumulated loudness, and how fast it is rising. */
  readonly loudness: number;
  readonly loudnessRate: number;
  /** Whether a Sancient is present, and whether anything has been permanently jacked. */
  readonly sancientPresent: boolean;
  readonly permanentJacks: number;
  /** Whether the site would flip if the player died right now. */
  readonly wouldFlipOnDeath: boolean;
  readonly zone: ExtractionZone;
}

export class HoldOrLeaveDecision {
  /** Assemble everything the player needs to choose. Presentation only — never advisory. */
  static assess(_context: DecisionContext): DecisionContext {
    // TODO: implement per DESIGN.md — gather live values for the ExtractionPrompt. Deliberately
    // returns facts and not a recommendation; the game does not tell you when to leave.
    throw new Error('HoldOrLeaveDecision.assess not implemented');
  }
}
