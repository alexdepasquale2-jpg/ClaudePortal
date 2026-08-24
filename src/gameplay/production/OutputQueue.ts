import type { MaterialCounts, SiteId } from '@core/types/Vocabulary';

/**
 * Material produced but not yet collected.
 *
 * Production does not go straight into a stockpile — it queues at the site. The queue is finite, so
 * a site left producing with nowhere to send it eventually backs up and stalls.
 *
 * That is what makes pipelines worth building rather than an optional convenience, and it is why
 * losing a site you had connected costs more than the site: it costs the throughput of everything
 * that fed through it.
 */
export class OutputQueue {
  private readonly queues = new Map<SiteId, MaterialCounts>();

  constructor(private readonly capacityPerSite: number) {}

  get capacity(): number {
    return this.capacityPerSite;
  }

  contents(siteId: SiteId): MaterialCounts | undefined {
    return this.queues.get(siteId);
  }

  /** Add production. Returns what did not fit — a stalled site is information, not a silent loss. */
  enqueue(_siteId: SiteId, _produced: MaterialCounts): MaterialCounts {
    // TODO: implement per DESIGN.md
    throw new Error('OutputQueue.enqueue not implemented');
  }

  /** Remove up to `amount` for a pipeline or a collecting player. */
  drain(_siteId: SiteId, _amount: number): MaterialCounts {
    // TODO: implement per DESIGN.md
    throw new Error('OutputQueue.drain not implemented');
  }

  isStalled(_siteId: SiteId): boolean {
    // TODO: implement per DESIGN.md — full queue means production has stopped paying.
    throw new Error('OutputQueue.isStalled not implemented');
  }
}
