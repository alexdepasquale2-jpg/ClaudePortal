import { Stockpile } from '@campaign/Stockpile';
import {
  emptyMaterialCounts,
  type MaterialCounts,
  type MaterialTier,
} from '@core/types/Vocabulary';

/**
 * What you are carrying, and what you stand to lose.
 *
 * The Greed pillar's mechanism. Capacity is weight-based, so the good material costs more to carry
 * — "there's more scrap over there" is only tempting because you had to decide what to drop.
 *
 * Critically: the backpack is session state. Dying loses all of it (RunResult.extracted is empty on
 * a Died end). Nothing here reaches the campaign except by walking out of the hole.
 */
export class Backpack {
  private contents: MaterialCounts = emptyMaterialCounts();

  constructor(private capacity: number) {}

  get held(): MaterialCounts {
    return this.contents;
  }

  get maxWeight(): number {
    return this.capacity;
  }

  /** Cards can raise capacity; that raise dies with the run, like the card. */
  setCapacity(capacity: number): void {
    this.capacity = capacity;
  }

  currentWeight(): number {
    // TODO: implement per DESIGN.md — sum per-tier weight from the material definitions.
    throw new Error('Backpack.currentWeight not implemented');
  }

  /** Add what fits; return what did not. Refusing silently would hide the decision from the player. */
  tryAdd(_tier: MaterialTier, _amount: number): number {
    // TODO: implement per DESIGN.md
    throw new Error('Backpack.tryAdd not implemented');
  }

  drop(tier: MaterialTier, amount: number): void {
    this.contents = Stockpile.subtract(this.contents, { [tier]: amount });
  }

  /** Hand contents to the run result on extraction. Emptied afterwards. */
  surrender(): MaterialCounts {
    const carried = this.contents;
    this.contents = emptyMaterialCounts();
    return carried;
  }
}
