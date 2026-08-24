import type { RunEndType } from '../types/Vocabulary';

/**
 * Leaderboards.
 *
 * DESIGN.md: "Leaderboards are bragging rights only. The graph is the keep." So this is an
 * interface with a no-op local implementation, and nothing in the game may read from it to make a
 * decision. A leaderboard that affected progression would put the keep somewhere other than the
 * graph.
 *
 * There is no server (ADR-0005). Submissions are held locally and can be exported with the campaign.
 */
export interface LeaderboardEntry {
  readonly runId: string;
  readonly endType: RunEndType;
  readonly siteId: string;
  readonly score: number;
  readonly durationMs: number;
  readonly submittedAt: number;
}

export interface LeaderboardClient {
  submit(entry: LeaderboardEntry): Promise<void>;
  top(limit: number): Promise<readonly LeaderboardEntry[]>;
}

/** The only implementation. Keeps entries in memory and forgets them on reload — bragging rights. */
export class LocalLeaderboardClient implements LeaderboardClient {
  private readonly entries: LeaderboardEntry[] = [];

  async submit(entry: LeaderboardEntry): Promise<void> {
    this.entries.push(entry);
  }

  async top(limit: number): Promise<readonly LeaderboardEntry[]> {
    return [...this.entries].sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
