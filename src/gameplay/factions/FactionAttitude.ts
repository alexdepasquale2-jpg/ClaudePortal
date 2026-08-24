import type { Attitude, FactionStanding } from '@campaign/FactionStanding';
import type { Faction } from '@core/types/Vocabulary';

/**
 * How each faction regards the player, at campaign scale.
 *
 * Persisted on the graph, so it is one more thing a run changes for the next one. Goliaths have no
 * attitude worth the name — they are machines, and what varies is competence, not disposition
 * (ADR-0003). Sancients and Nobots are where this actually matters.
 *
 * Attitude does not replace radicalisation; radicalisation is the Nobot-specific counter that ends
 * in betrayal, while attitude is the broader standing that survives it.
 *
 * The Attitude and FactionStanding types live in `campaign` because the Faction menu has to render
 * them and `ui` cannot import `gameplay`. This class is the runtime that moves those values.
 */
export type { Attitude, FactionStanding };

export class FactionAttitude {
  private readonly standings = new Map<Faction, number>();

  get(faction: Faction): number {
    return this.standings.get(faction) ?? 0;
  }

  adjust(_faction: Faction, _delta: number): void {
    // TODO: implement per DESIGN.md — clamp to -1..1.
    throw new Error('FactionAttitude.adjust not implemented');
  }

  attitudeFor(_faction: Faction): Attitude {
    // TODO: implement per DESIGN.md — band the standing value.
    throw new Error('FactionAttitude.attitudeFor not implemented');
  }

  snapshot(): readonly FactionStanding[] {
    // TODO: implement per DESIGN.md
    throw new Error('FactionAttitude.snapshot not implemented');
  }
}
