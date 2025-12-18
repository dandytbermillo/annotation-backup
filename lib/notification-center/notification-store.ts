/**
 * Notification Store
 *
 * Central store for managing notifications with:
 * - In-memory state for fast UI updates
 * - IndexedDB persistence for durability
 * - Subscription system for React integration
 * - Automatic deduplication and retention
 */

import type {
  Notification,
  NotificationEvent,
  NotificationStore,
  NotificationStoreState,
  NotificationStoreListener,
  NotificationStorageAdapter,
  RetentionPolicy,
  ClearOptions,
} from './types';
import { getNotificationStorageAdapter } from './indexeddb-adapter';

// Default retention policy
const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  maxCount: 200,
  dismissedMaxAgeDays: 30,
  maxAgeDays: 90,
};

class NotificationStoreImpl implements NotificationStore {
  private state: NotificationStoreState = {
    notifications: new Map(),
    unreadCounts: new Map(),
    initialized: false,
    currentEntryId: null,
  };

  private listeners: Set<NotificationStoreListener> = new Set();
  private adapter: NotificationStorageAdapter;
  private retentionPolicy: RetentionPolicy;

  constructor(
    adapter?: NotificationStorageAdapter,
    retentionPolicy?: RetentionPolicy
  ) {
    this.adapter = adapter ?? getNotificationStorageAdapter();
    this.retentionPolicy = retentionPolicy ?? DEFAULT_RETENTION_POLICY;
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        console.error('[NotificationStore] Listener error:', error);
      }
    }
  }

  private async loadNotifications(entryId: string): Promise<void> {
    try {
      const notifications = await this.adapter.getAll(entryId);
      const unreadCount = await this.adapter.getUnreadCount(entryId);

      this.state.notifications.clear();
      for (const n of notifications) {
        this.state.notifications.set(n.id, n);
      }
      this.state.unreadCounts.set(entryId, unreadCount);
      this.state.currentEntryId = entryId;

      this.notifyListeners();
    } catch (error) {
      console.error('[NotificationStore] Failed to load notifications:', error);
      throw error;
    }
  }

  async initialize(entryId: string): Promise<void> {
    if (this.state.initialized && this.state.currentEntryId === entryId) {
      return;
    }

    try {
      await this.adapter.initialize();

      // Prune old notifications on init
      try {
        await this.adapter.prune(entryId, this.retentionPolicy);
      } catch (pruneError) {
        console.warn('[NotificationStore] Prune failed (non-fatal):', pruneError);
      }

      await this.loadNotifications(entryId);
      this.state.initialized = true;
      this.notifyListeners();
    } catch (error) {
      console.error('[NotificationStore] Initialization failed:', error);
      throw error;
    }
  }

  async switchEntry(entryId: string): Promise<void> {
    if (this.state.currentEntryId === entryId) {
      return;
    }

    // Prune old entry before switching
    if (this.state.currentEntryId) {
      try {
        await this.adapter.prune(this.state.currentEntryId, this.retentionPolicy);
      } catch (pruneError) {
        console.warn('[NotificationStore] Prune on switch failed (non-fatal):', pruneError);
      }
    }

    await this.loadNotifications(entryId);
  }

  async emit(event: NotificationEvent): Promise<string> {
    const entryId = event.entryId;

    // Ensure we're initialized for this entry
    if (!this.state.initialized) {
      await this.initialize(entryId);
    } else if (this.state.currentEntryId !== entryId) {
      // Emit to a different entry - just persist, don't switch context
      // This supports background notifications for other entries
    }

    const now = new Date().toISOString();

    const notificationData: Omit<Notification, 'id'> = {
      entryId: event.entryId,
      workspaceId: event.workspaceId ?? null,
      severity: event.severity,
      category: event.category,
      title: event.title,
      description: event.description ?? null,
      details: event.details ?? null,
      dedupeKey: event.dedupeKey ?? null,
      count: 1,
      createdAt: now,
      lastSeenAt: now,
      readAt: null,
      dismissedAt: null,
    };

    try {
      const id = await this.adapter.upsert(notificationData);

      // If this is for the current entry, update in-memory state
      if (this.state.currentEntryId === entryId) {
        await this.loadNotifications(entryId);
      }

      return id;
    } catch (error) {
      console.error('[NotificationStore] Failed to emit notification:', error);
      throw error;
    }
  }

  async markRead(id: string): Promise<void> {
    const notification = this.state.notifications.get(id);
    if (!notification) {
      console.warn('[NotificationStore] Notification not found:', id);
      return;
    }

    if (notification.readAt !== null) {
      return; // Already read
    }

    try {
      await this.adapter.update(id, { readAt: new Date().toISOString() });

      // Update in-memory state
      notification.readAt = new Date().toISOString();
      this.state.notifications.set(id, { ...notification });

      // Update unread count
      const entryId = notification.entryId;
      const currentCount = this.state.unreadCounts.get(entryId) ?? 0;
      this.state.unreadCounts.set(entryId, Math.max(0, currentCount - 1));

      this.notifyListeners();
    } catch (error) {
      console.error('[NotificationStore] Failed to mark read:', error);
      throw error;
    }
  }

  async markAllRead(): Promise<void> {
    const entryId = this.state.currentEntryId;
    if (!entryId) {
      return;
    }

    const now = new Date().toISOString();
    const updates: Promise<void>[] = [];

    for (const [id, notification] of this.state.notifications) {
      if (notification.entryId === entryId && notification.readAt === null) {
        updates.push(this.adapter.update(id, { readAt: now }));
        notification.readAt = now;
        this.state.notifications.set(id, { ...notification });
      }
    }

    try {
      await Promise.all(updates);
      this.state.unreadCounts.set(entryId, 0);
      this.notifyListeners();
    } catch (error) {
      console.error('[NotificationStore] Failed to mark all read:', error);
      throw error;
    }
  }

  async dismiss(id: string): Promise<void> {
    const notification = this.state.notifications.get(id);
    if (!notification) {
      console.warn('[NotificationStore] Notification not found:', id);
      return;
    }

    try {
      const now = new Date().toISOString();
      await this.adapter.update(id, { dismissedAt: now });

      // Update in-memory state
      notification.dismissedAt = now;
      this.state.notifications.set(id, { ...notification });

      // Update unread count if it was unread
      if (notification.readAt === null) {
        const entryId = notification.entryId;
        const currentCount = this.state.unreadCounts.get(entryId) ?? 0;
        this.state.unreadCounts.set(entryId, Math.max(0, currentCount - 1));
      }

      this.notifyListeners();
    } catch (error) {
      console.error('[NotificationStore] Failed to dismiss:', error);
      throw error;
    }
  }

  async clearAll(options?: ClearOptions): Promise<void> {
    const entryId = this.state.currentEntryId;
    if (!entryId) {
      return;
    }

    try {
      await this.adapter.clear(entryId, options);
      await this.loadNotifications(entryId);
    } catch (error) {
      console.error('[NotificationStore] Failed to clear:', error);
      throw error;
    }
  }

  getNotifications(): Notification[] {
    const entryId = this.state.currentEntryId;
    if (!entryId) {
      return [];
    }

    // Return notifications for current entry, sorted by lastSeenAt descending
    return Array.from(this.state.notifications.values())
      .filter((n) => n.entryId === entryId)
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
  }

  getUnreadCount(): number {
    const entryId = this.state.currentEntryId;
    if (!entryId) {
      return 0;
    }
    return this.state.unreadCounts.get(entryId) ?? 0;
  }

  // Arrow function to preserve `this` context when passed to useSyncExternalStore
  subscribe = (listener: NotificationStoreListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // Arrow function to preserve `this` context when passed to useSyncExternalStore
  getState = (): NotificationStoreState => {
    return this.state;
  };
}

// ============================================================================
// Singleton Instance
// ============================================================================

let storeInstance: NotificationStore | null = null;

export function getNotificationStore(): NotificationStore {
  if (!storeInstance) {
    storeInstance = new NotificationStoreImpl();
  }
  return storeInstance;
}

// ============================================================================
// Convenience Functions (for producer use)
// ============================================================================

/**
 * Emit a notification event.
 * This is the primary API for producers (eviction, persistence, etc).
 *
 * @example
 * ```typescript
 * await emitNotification({
 *   entryId: currentEntryId,
 *   workspaceId: workspaceId,
 *   severity: 'error',
 *   category: 'eviction',
 *   title: 'Eviction blocked',
 *   description: 'Changes could not be saved. Workspace was not evicted.',
 *   dedupeKey: `entry:${entryId}:eviction_blocked:ws:${workspaceId}`,
 *   details: { workspaceId, reason: 'persist_failed' },
 * });
 * ```
 */
export async function emitNotification(event: NotificationEvent): Promise<string> {
  const store = getNotificationStore();

  // Ensure store is initialized with the event's entry
  if (!store.getState().initialized) {
    await store.initialize(event.entryId);
  }

  return store.emit(event);
}

/**
 * Create a dedupe key for common notification patterns.
 */
export function createDedupeKey(
  pattern:
    | { type: 'persist_failed'; entryId: string; workspaceId: string }
    | { type: 'eviction_blocked'; entryId: string; workspaceId: string }
    | { type: 'degraded_mode_entered'; entryId: string }
    | { type: 'offline_queued'; entryId: string }
    | { type: 'custom'; key: string }
): string {
  switch (pattern.type) {
    case 'persist_failed':
      return `entry:${pattern.entryId}:persist_failed:ws:${pattern.workspaceId}`;
    case 'eviction_blocked':
      return `entry:${pattern.entryId}:eviction_blocked:ws:${pattern.workspaceId}`;
    case 'degraded_mode_entered':
      return `entry:${pattern.entryId}:degraded_mode_entered`;
    case 'offline_queued':
      return `entry:${pattern.entryId}:offline_queued`;
    case 'custom':
      return pattern.key;
    default:
      throw new Error('Unknown dedupe key pattern');
  }
}
