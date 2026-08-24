import type { MaterialCounts } from '@core/types/Vocabulary';

/**
 * What you get back for dismantling your own fort.
 *
 * The refund is partial and it is never full, for a reason: if scrapping returned everything, a
 * player would build and unbuild freely and the fort would stop being a commitment. Building is a
 * bet on where the fight will be.
 *
 * A piece DESTROYED by enemies refunds nothing at all — that path does not come through here.
 * Scrapping is host-authoritative like every other fort mutation.
 */
export class ScrapRefund {
  constructor(
    /** Fraction of the original cost returned, 0..1. Never 1. */
    private readonly rate: number,
  ) {
    if (rate >= 1) throw new Error('Scrap refund must be less than the original cost');
  }

  get refundRate(): number {
    return this.rate;
  }

  /** Refund for a solidified piece. */
  refundFor(_pieceId: string): MaterialCounts {
    // TODO: implement per DESIGN.md — cost * rate, floored per tier.
    throw new Error('ScrapRefund.refundFor not implemented');
  }

  /** A ghost never cost anything, so cancelling one is free rather than refunded. */
  refundForGhost(): MaterialCounts {
    return { Scrap: 0, Rack: 0, Plate: 0, PyronChrome: 0 };
  }
}
