import { CampaignSaveSerializer } from './CampaignSaveSerializer';
import type { CampaignSave } from './CampaignSave';

/**
 * IndexedDB persistence for campaign saves.
 *
 * Local-only, no server, no account (ADR-0005). localStorage was rejected: the archipelago graph
 * plus per-site history will exceed its ~5MB cap, and its synchronous API stalls the frame.
 *
 * Written when a run RESOLVES, never continuously. A run in progress is not a campaign state, so
 * closing the tab mid-run loses the run — which is correct. The run is the thing you can lose.
 */
const DB_NAME = 'skyneet';
const DB_VERSION = 1;
const STORE = 'campaign';

export class CampaignStore {
  private readonly serializer = new CampaignSaveSerializer();
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'slotId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    });
  }

  async save(save: CampaignSave): Promise<void> {
    // Serialize through the serializer so a save that cannot be re-read never reaches the store.
    const json = this.serializer.serialize(save);
    await this.transact('readwrite', (store) => store.put({ slotId: save.slotId, json }));
  }

  async load(slotId: string): Promise<CampaignSave | null> {
    const record = await this.transact<{ slotId: string; json: string } | undefined>(
      'readonly',
      (store) => store.get(slotId),
    );
    return record ? this.serializer.deserialize(record.json) : null;
  }

  async listSlots(): Promise<readonly string[]> {
    const keys = await this.transact<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
    return keys.map(String);
  }

  async delete(slotId: string): Promise<void> {
    await this.transact('readwrite', (store) => store.delete(slotId));
  }

  /** Export for the player to keep. Same shape as what is stored. */
  exportToJson(save: CampaignSave): string {
    return this.serializer.serialize(save);
  }

  /** Import a previously exported campaign. Refuses anything it cannot validate. */
  importFromJson(json: string): CampaignSave {
    return this.serializer.deserialize(json);
  }

  private async transact<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    await this.open();
    const db = this.db;
    if (!db) throw new Error('CampaignStore is not open');
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  }
}
