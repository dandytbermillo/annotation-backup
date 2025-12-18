/**
 * IndexedDB Storage Adapter for Notification Center
 *
 * Provides local-first, durable storage for notifications.
 * Works offline and persists across browser reloads.
 *
 * Storage layout:
 * - Index by entryId for scoped queries
 * - Compound index on [entryId, dedupeKey] for atomic upsert
 */

import type {
  Notification,
  NotificationStorageAdapter,
  RetentionPolicy,
  ClearOptions,
} from './types';

const DB_NAME = 'notification-center';
const DB_VERSION = 1;
const STORE_NAME = 'notifications';

export class IndexedDBNotificationAdapter implements NotificationStorageAdapter {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private ready = false;

  /**
   * Initialize the IndexedDB database.
   * Creates the object store and indexes if they don't exist.
   */
  async initialize(): Promise<void> {
    // Prevent double initialization
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      // Check if IndexedDB is available
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.ready = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create notifications object store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });

          // Index for querying by entryId (most common query)
          store.createIndex('entryId', 'entryId', { unique: false });

          // Compound index for dedupe lookups: [entryId, dedupeKey]
          store.createIndex('entryId_dedupeKey', ['entryId', 'dedupeKey'], {
            unique: false,
          });

          // Index for sorting by createdAt
          store.createIndex('createdAt', 'createdAt', { unique: false });

          // Index for finding unread notifications
          store.createIndex('entryId_readAt', ['entryId', 'readAt'], {
            unique: false,
          });

          // Index for finding dismissed notifications (for pruning)
          store.createIndex('dismissedAt', 'dismissedAt', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  isReady(): boolean {
    return this.ready && this.db !== null;
  }

  private ensureReady(): void {
    if (!this.isReady()) {
      throw new Error('NotificationStorageAdapter not initialized. Call initialize() first.');
    }
  }

  private getStore(mode: IDBTransactionMode): IDBObjectStore {
    this.ensureReady();
    const transaction = this.db!.transaction(STORE_NAME, mode);
    return transaction.objectStore(STORE_NAME);
  }

  /**
   * Wrap an IDBRequest in a Promise.
   */
  private promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Execute a callback within a transaction and return the result.
   */
  private async withTransaction<T>(
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => Promise<T>
  ): Promise<T> {
    this.ensureReady();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);

      let result: T;
      let callbackError: Error | null = null;

      // Execute the callback and capture the result
      callback(store)
        .then((r) => {
          result = r;
        })
        .catch((err) => {
          callbackError = err;
          transaction.abort();
        });

      transaction.oncomplete = () => {
        if (callbackError) {
          reject(callbackError);
        } else {
          resolve(result);
        }
      };

      transaction.onerror = () => {
        reject(transaction.error || callbackError);
      };

      transaction.onabort = () => {
        reject(callbackError || new Error('Transaction aborted'));
      };
    });
  }

  async getAll(entryId: string): Promise<Notification[]> {
    const store = this.getStore('readonly');
    const index = store.index('entryId');
    const request = index.getAll(entryId);
    const notifications = await this.promisify(request);

    // Sort by lastSeenAt descending (newest first)
    return notifications.sort(
      (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
    );
  }

  async getUnreadCount(entryId: string): Promise<number> {
    const store = this.getStore('readonly');
    const index = store.index('entryId');
    const request = index.getAll(entryId);
    const notifications = await this.promisify(request);

    return notifications.filter((n) => n.readAt === null && n.dismissedAt === null).length;
  }

  /**
   * Atomic upsert with dedupe support.
   *
   * If dedupeKey is provided and matches an existing notification:
   * - Increment count
   * - Update lastSeenAt
   * - Return existing ID
   *
   * Otherwise, create a new notification and return its ID.
   */
  async upsert(notification: Omit<Notification, 'id'> & { id?: string }): Promise<string> {
    return this.withTransaction('readwrite', async (store) => {
      // If dedupeKey is set, check for existing notification
      if (notification.dedupeKey) {
        const index = store.index('entryId_dedupeKey');
        const lookupKey = [notification.entryId, notification.dedupeKey];

        // Get all matching (there might be multiple due to index not being unique)
        const request = index.getAll(lookupKey);
        const existing = await this.promisify(request);

        // Find a non-dismissed match
        const match = existing.find((n) => n.dismissedAt === null);

        if (match) {
          // Update existing notification with latest info
          const updated: Notification = {
            ...match,
            // Update to latest content so notification reflects current state
            title: notification.title,
            description: notification.description ?? match.description,
            severity: notification.severity,
            // Increment count and update timestamp
            count: match.count + 1,
            lastSeenAt: new Date().toISOString(),
            // Update details if provided
            ...(notification.details !== undefined && { details: notification.details }),
          };

          const putRequest = store.put(updated);
          await this.promisify(putRequest);
          return match.id;
        }
      }

      // Create new notification
      const id = notification.id || crypto.randomUUID();
      const now = new Date().toISOString();

      const newNotification: Notification = {
        id,
        entryId: notification.entryId,
        workspaceId: notification.workspaceId ?? null,
        severity: notification.severity,
        category: notification.category,
        title: notification.title,
        description: notification.description ?? null,
        details: notification.details ?? null,
        dedupeKey: notification.dedupeKey ?? null,
        count: notification.count ?? 1,
        createdAt: notification.createdAt ?? now,
        lastSeenAt: notification.lastSeenAt ?? now,
        readAt: notification.readAt ?? null,
        dismissedAt: notification.dismissedAt ?? null,
      };

      const putRequest = store.put(newNotification);
      await this.promisify(putRequest);
      return id;
    });
  }

  async update(
    id: string,
    changes: Partial<Pick<Notification, 'readAt' | 'dismissedAt'>>
  ): Promise<void> {
    return this.withTransaction('readwrite', async (store) => {
      const request = store.get(id);
      const existing = await this.promisify(request);

      if (!existing) {
        throw new Error(`Notification not found: ${id}`);
      }

      const updated: Notification = {
        ...existing,
        ...changes,
      };

      const putRequest = store.put(updated);
      await this.promisify(putRequest);
    });
  }

  async delete(id: string): Promise<void> {
    const store = this.getStore('readwrite');
    const request = store.delete(id);
    await this.promisify(request);
  }

  /**
   * Prune notifications according to retention policy:
   * 1. Remove dismissed notifications older than dismissedMaxAgeDays
   * 2. Remove all notifications older than maxAgeDays
   * 3. If count exceeds maxCount, remove oldest until at limit
   */
  async prune(entryId: string, policy: RetentionPolicy): Promise<number> {
    const now = new Date();
    let removedCount = 0;

    const notifications = await this.getAll(entryId);

    const toDelete: string[] = [];

    for (const n of notifications) {
      const createdDate = new Date(n.createdAt);
      const ageDays = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

      // Rule 1: Remove dismissed notifications older than dismissedMaxAgeDays
      if (n.dismissedAt !== null) {
        const dismissedDate = new Date(n.dismissedAt);
        const dismissedAgeDays =
          (now.getTime() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);
        if (dismissedAgeDays > policy.dismissedMaxAgeDays) {
          toDelete.push(n.id);
          continue;
        }
      }

      // Rule 2: Remove notifications older than maxAgeDays
      if (ageDays > policy.maxAgeDays) {
        toDelete.push(n.id);
      }
    }

    // Delete marked notifications
    for (const id of toDelete) {
      await this.delete(id);
      removedCount++;
    }

    // Rule 3: Enforce maxCount (after other deletions)
    const remaining = await this.getAll(entryId);
    if (remaining.length > policy.maxCount) {
      // Sort by lastSeenAt ascending (oldest first)
      const sorted = remaining.sort(
        (a, b) => new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime()
      );

      const excessCount = sorted.length - policy.maxCount;
      for (let i = 0; i < excessCount; i++) {
        await this.delete(sorted[i].id);
        removedCount++;
      }
    }

    return removedCount;
  }

  async clear(entryId: string, options?: ClearOptions): Promise<void> {
    const notifications = await this.getAll(entryId);

    for (const n of notifications) {
      let shouldDelete = true;

      if (options?.readOnly && n.readAt === null) {
        shouldDelete = false;
      }

      if (options?.dismissedOnly && n.dismissedAt === null) {
        shouldDelete = false;
      }

      if (options?.olderThan) {
        const threshold = new Date(options.olderThan);
        if (new Date(n.createdAt) >= threshold) {
          shouldDelete = false;
        }
      }

      if (shouldDelete) {
        await this.delete(n.id);
      }
    }
  }
}

/**
 * Singleton instance of the IndexedDB adapter.
 * Use this for the notification center.
 */
let adapterInstance: IndexedDBNotificationAdapter | null = null;

export function getNotificationStorageAdapter(): NotificationStorageAdapter {
  if (!adapterInstance) {
    adapterInstance = new IndexedDBNotificationAdapter();
  }
  return adapterInstance;
}
