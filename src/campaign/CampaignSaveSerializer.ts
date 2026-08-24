import { CAMPAIGN_SAVE_VERSION, CampaignSaveSchema, type CampaignSave } from './CampaignSave';

/**
 * Turns a campaign save into JSON and back, across schema versions.
 *
 * Implemented for real, not stubbed, because SAVE-FORMAT.md makes two promises the rest of the game
 * relies on: a save round-trips exactly, and a save from an unknown future version is refused
 * rather than guessed at. Both are asserted in tests/unit/CampaignSaveRoundTrip.test.ts.
 *
 * There is no auto-repair. A save that fails validation reports which field failed and stops.
 * The graph is the player's whole investment (ADR-0001) — silently mangling it is the one bug that
 * cannot be apologised away.
 */

export type Migration = (older: Record<string, unknown>) => Record<string, unknown>;

export class SaveVersionError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(
      `Campaign save is version ${found}, but this build supports up to ${supported}. ` +
        'Refusing to load rather than guess at its shape. Export it and update the game.',
    );
    this.name = 'SaveVersionError';
  }
}

export class CampaignSaveSerializer {
  /**
   * Migrations from version N to N+1, in order. `migrations[0]` takes a v1 document to v2.
   * Each must be a pure function. Adding one means bumping CAMPAIGN_SAVE_VERSION.
   */
  private readonly migrations: readonly Migration[] = [];

  serialize(save: CampaignSave): string {
    // Validate on the way out too: a save that cannot be re-read is worse than a failed write.
    const validated = CampaignSaveSchema.parse({ ...save, updatedAt: Date.now() });
    return JSON.stringify(validated);
  }

  deserialize(json: string): CampaignSave {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch (error) {
      throw new Error(`Campaign save is not valid JSON: ${(error as Error).message}`);
    }
    return this.fromObject(raw);
  }

  fromObject(raw: unknown): CampaignSave {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Campaign save must be an object');
    }
    const document = raw as Record<string, unknown>;
    const version = document['version'];
    if (typeof version !== 'number') {
      throw new Error('Campaign save has no version field');
    }
    if (version > CAMPAIGN_SAVE_VERSION) {
      throw new SaveVersionError(version, CAMPAIGN_SAVE_VERSION);
    }

    const migrated = this.migrate(document, version);
    const result = CampaignSaveSchema.safeParse(migrated);
    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `  ${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('\n');
      throw new Error(`Campaign save failed validation:\n${detail}`);
    }
    return result.data;
  }

  /** Apply each migration in sequence from the document's version to the current one. */
  private migrate(document: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
    let current = document;
    for (let version = fromVersion; version < CAMPAIGN_SAVE_VERSION; version++) {
      const migration = this.migrations[version - 1];
      if (!migration) {
        throw new Error(`No migration registered from campaign save version ${version}`);
      }
      current = migration(current);
      current['version'] = version + 1;
    }
    return current;
  }
}
