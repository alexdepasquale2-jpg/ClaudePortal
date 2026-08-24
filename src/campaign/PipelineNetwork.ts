import type { MaterialCounts, SiteId } from '@core/types/Vocabulary';
import type { CampaignAdvanceable, CampaignStep } from '@core/time/TimeAdvancer';
import type { Pipeline } from './Pipeline';

/**
 * All pipelines, and the flow they produce each campaign tick.
 *
 * Advanced by TimeAdvancer when a run resolves, not continuously — which is what makes returning to
 * the World menu feel like time passed while you were underground.
 *
 * Registration order matters: production runs before this, so materials produced this step can move
 * this step. See TimeAdvancer.
 */
export class PipelineNetwork implements CampaignAdvanceable {
  private readonly pipelines = new Map<string, Pipeline>();

  get all(): readonly Pipeline[] {
    return [...this.pipelines.values()];
  }

  upsert(pipeline: Pipeline): void {
    this.pipelines.set(pipeline.id, pipeline);
  }

  remove(id: string): void {
    this.pipelines.delete(id);
  }

  from(siteId: SiteId): readonly Pipeline[] {
    return this.all.filter((pipeline) => pipeline.from === siteId && pipeline.active);
  }

  into(siteId: SiteId): readonly Pipeline[] {
    return this.all.filter((pipeline) => pipeline.to === siteId && pipeline.active);
  }

  /** Net material change per site for one campaign step. */
  flow(_step: CampaignStep): ReadonlyMap<SiteId, MaterialCounts> {
    // TODO: implement per DESIGN.md — move up to `throughput` of each carried tier along every
    // active pipeline, limited by what the source site actually holds.
    throw new Error('PipelineNetwork.flow not implemented');
  }

  advance(_step: CampaignStep): void {
    // TODO: implement per DESIGN.md — apply flow, then roll exposure against the current warfront
    // to decide whether any route is cut this step.
    throw new Error('PipelineNetwork.advance not implemented');
  }
}
