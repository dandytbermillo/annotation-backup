/**
 * Notification Center Types
 *
 * Local-first notification system using IndexedDB for durability.
 * Designed to work offline and persist across reloads.
 */

// ============================================================================
// Core Types
// ============================================================================

export type NotificationSeverity = 'error' | 'warning' | 'info' | 'success';

export type NotificationCategory =
  | 'workspace'
  | 'persistence'
  | 'eviction'
  | 'offline'
  | 'system';

export interface Notification {
  /** Unique identifier (UUID) */
  id: string;

  /** Entry ID this notification belongs to (required for scoping) */
  entryId: string;

  /** Optional workspace ID for workspace-specific notifications */
  workspaceId: string | null;

  /** Severity level */
  severity: NotificationSeverity;

  /** Category for filtering */
  category: NotificationCategory;

  /** Short title */
  title: string;

  /** Optional longer description */
  description: string | null;

  /** Optional structured details (JSON-serializable) */
  details: Record<string, unknown> | null;

  /**
   * Dedupe key for aggregating repeated events.
   * If set, subsequent notifications with the same key will increment count
   * instead of creating new records.
   *
   * Example patterns:
   * - `entry:{entryId}:persist_failed:ws:{workspaceId}`
   * - `entry:{entryId}:degraded_mode_entered`
   */
  dedupeKey: string | null;

  /** Number of times this notification occurred (for deduped events) */
  count: number;

  /** When the notification was first created */
  createdAt: string;

  /** When the notification was last seen (updated on dedupe) */
  lastSeenAt: string;

  /** When the notification was marked as read (null if unread) */
  readAt: string | null;

  /** When the notification was dismissed (null if not dismissed) */
  dismissedAt: string | null;
}

// ============================================================================
// Event Types (for emitting notifications)
// ============================================================================

export interface NotificationEvent {
  /** Entry ID this notification belongs to */
  entryId: string;

  /** Optional workspace ID */
  workspaceId?: string | null;

  /** Severity level */
  severity: NotificationSeverity;

  /** Category */
  category: NotificationCategory;

  /** Short title */
  title: string;

  /** Optional description */
  description?: string | null;

  /** Optional structured details */
  details?: Record<string, unknown> | null;

  /** Optional dedupe key for aggregation */
  dedupeKey?: string | null;
}

// ============================================================================
// Storage Adapter Types
// ============================================================================

export interface RetentionPolicy {
  /** Maximum notifications per entry (oldest removed first) */
  maxCount: number;

  /** Max age in days for dismissed notifications before auto-removal */
  dismissedMaxAgeDays: number;

  /** Max age in days for all notifications */
  maxAgeDays: number;
}

export interface ClearOptions {
  /** Only clear read notifications */
  readOnly?: boolean;

  /** Only clear dismissed notifications */
  dismissedOnly?: boolean;

  /** Only clear notifications older than this date */
  olderThan?: string;
}

export interface NotificationStorageAdapter {
  /**
   * Initialize the storage (create database/tables if needed).
   * Must be called before any other operations.
   */
  initialize(): Promise<void>;

  /**
   * Get all notifications for an entry.
   * Returns newest first by default.
   */
  getAll(entryId: string): Promise<Notification[]>;

  /**
   * Get unread count for an entry.
   */
  getUnreadCount(entryId: string): Promise<number>;

  /**
   * Atomic upsert with dedupe support.
   * If dedupeKey matches an existing notification, increments count and updates lastSeenAt.
   * Otherwise, creates a new notification.
   * Returns the notification ID (existing or new).
   */
  upsert(notification: Omit<Notification, 'id'> & { id?: string }): Promise<string>;

  /**
   * Update specific fields of a notification.
   */
  update(id: string, changes: Partial<Pick<Notification, 'readAt' | 'dismissedAt'>>): Promise<void>;

  /**
   * Delete a notification by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Prune notifications according to retention policy.
   * Returns the number of notifications removed.
   */
  prune(entryId: string, policy: RetentionPolicy): Promise<number>;

  /**
   * Clear notifications for an entry with optional filtering.
   */
  clear(entryId: string, options?: ClearOptions): Promise<void>;

  /**
   * Check if the storage is available and initialized.
   */
  isReady(): boolean;
}

// ============================================================================
// Store Types
// ============================================================================

export interface NotificationStoreState {
  /** Notifications keyed by ID for fast lookup */
  notifications: Map<string, Notification>;

  /** Unread count per entry */
  unreadCounts: Map<string, number>;

  /** Whether the store has been initialized */
  initialized: boolean;

  /** Current entry ID (for scoping) */
  currentEntryId: string | null;
}

export type NotificationStoreListener = (state: NotificationStoreState) => void;

export interface NotificationStore {
  /**
   * Initialize the store and load notifications for the current entry.
   */
  initialize(entryId: string): Promise<void>;

  /**
   * Switch to a different entry (reloads notifications).
   */
  switchEntry(entryId: string): Promise<void>;

  /**
   * Emit a new notification event.
   */
  emit(event: NotificationEvent): Promise<string>;

  /**
   * Mark a notification as read.
   */
  markRead(id: string): Promise<void>;

  /**
   * Mark all notifications for current entry as read.
   */
  markAllRead(): Promise<void>;

  /**
   * Dismiss a notification (soft delete - still visible in history but marked).
   */
  dismiss(id: string): Promise<void>;

  /**
   * Clear all notifications for current entry.
   */
  clearAll(options?: ClearOptions): Promise<void>;

  /**
   * Get all notifications for the current entry.
   */
  getNotifications(): Notification[];

  /**
   * Get unread count for the current entry.
   */
  getUnreadCount(): number;

  /**
   * Subscribe to state changes.
   */
  subscribe(listener: NotificationStoreListener): () => void;

  /**
   * Get the current state (for React hooks).
   */
  getState(): NotificationStoreState;
}

// ============================================================================
// UI Filter Types
// ============================================================================

export type NotificationFilter = 'all' | NotificationSeverity;

export interface NotificationPanelState {
  /** Current filter */
  filter: NotificationFilter;

  /** Whether the panel is open */
  isOpen: boolean;

  /** Currently expanded notification ID (for details view) */
  expandedId: string | null;
}
