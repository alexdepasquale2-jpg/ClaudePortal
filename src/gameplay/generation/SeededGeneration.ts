import { SeededRandom } from '@core/utilities/SeededRandom';

/**
 * Derives every random stream a run needs from one campaign seed.
 *
 * A site must be reproducible from (campaignSeed, siteId, runIndex). ARCHITECTURE.md calls this a
 * prerequisite, not a feature: without it, SeededGeneration means nothing, a leaderboard claim can
 * never be checked, and two players cannot compare the same site.
 *
 * Streams are derived by NAME rather than drawn in sequence, so adding a new system that needs
 * randomness does not shift every existing stream and silently change every site in the game.
 */
export const GenerationStreams = {
  layout: 'layout',
  materials: 'materials',
  goliaths: 'goliaths',
  nobots: 'nobots',
  sancients: 'sancients',
  pyronChrome: 'pyron-chrome',
  cards: 'cards',
} as const;

export type GenerationStream = (typeof GenerationStreams)[keyof typeof GenerationStreams];

export class SeededGeneration {
  private readonly root: SeededRandom;

  constructor(
    readonly campaignSeed: number,
    readonly siteId: string,
    readonly runIndex: number,
  ) {
    this.root = SeededRandom.derive(campaignSeed, `${siteId}#${runIndex}`);
  }

  /** A named, independent stream. Same name, same inputs, same numbers, forever. */
  stream(name: GenerationStream): SeededRandom {
    return SeededRandom.derive(this.root.seed, name);
  }

  /**
   * The site layout stream specifically — separated because layout must stay stable even when
   * spawn tuning changes. A player who learned a site's shape should not find it rearranged
   * because a Goliath's spawn weight was adjusted.
   */
  layoutStream(): SeededRandom {
    return this.stream(GenerationStreams.layout);
  }
}
