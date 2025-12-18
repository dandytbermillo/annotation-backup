/**
 * React Hook for Notification Center
 *
 * Provides reactive access to the notification store.
 *
 * @example
 * ```tsx
 * function NotificationBell() {
 *   const { unreadCount } = useNotificationCenter();
 *   return <Badge count={unreadCount} />;
 * }
 *
 * function NotificationPanel() {
 *   const {
 *     notifications,
 *     unreadCount,
 *     markRead,
 *     markAllRead,
 *     dismiss,
 *     clearAll,
 *   } = useNotificationCenter();
 *
 *   return (
 *     <div>
 *       {notifications.map((n) => (
 *         <NotificationItem
 *           key={n.id}
 *           notification={n}
 *           onMarkRead={() => markRead(n.id)}
 *           onDismiss={() => dismiss(n.id)}
 *         />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import type {
  Notification,
  NotificationFilter,
  ClearOptions,
} from '@/lib/notification-center/types';
import { getNotificationStore } from '@/lib/notification-center/notification-store';

export interface UseNotificationCenterOptions {
  /**
   * Entry ID to scope notifications to.
   * If not provided, uses the store's current entry.
   */
  entryId?: string;

  /**
   * Filter notifications by severity.
   */
  filter?: NotificationFilter;

  /**
   * Whether to include dismissed notifications.
   * Default: false
   */
  includeDismissed?: boolean;
}

export interface UseNotificationCenterResult {
  /** All notifications (filtered) */
  notifications: Notification[];

  /** Unread count */
  unreadCount: number;

  /** Whether the store is initialized */
  initialized: boolean;

  /** Mark a notification as read */
  markRead: (id: string) => Promise<void>;

  /** Mark all notifications as read */
  markAllRead: () => Promise<void>;

  /** Dismiss a notification */
  dismiss: (id: string) => Promise<void>;

  /** Clear all notifications */
  clearAll: (options?: ClearOptions) => Promise<void>;

  /** Initialize the store (if not already) */
  initialize: (entryId: string) => Promise<void>;
}

/**
 * Hook for accessing the notification center.
 */
export function useNotificationCenter(
  options: UseNotificationCenterOptions = {}
): UseNotificationCenterResult {
  const { filter = 'all', includeDismissed = false } = options;

  const store = getNotificationStore();

  // Subscribe to store updates using useSyncExternalStore for concurrent mode safety
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState // Server snapshot (same as client for now)
  );

  // Filter notifications based on options
  const filteredNotifications = useCallback((): Notification[] => {
    let notifications = store.getNotifications();

    // Filter out dismissed unless requested
    if (!includeDismissed) {
      notifications = notifications.filter((n) => n.dismissedAt === null);
    }

    // Apply severity filter
    if (filter !== 'all') {
      notifications = notifications.filter((n) => n.severity === filter);
    }

    return notifications;
  }, [store, filter, includeDismissed]);

  // Memoize the filtered result (re-compute when state changes)
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    setNotifications(filteredNotifications());
  }, [state, filteredNotifications]);

  // Wrap store methods to maintain reference stability
  const markRead = useCallback(
    async (id: string) => {
      await store.markRead(id);
    },
    [store]
  );

  const markAllRead = useCallback(async () => {
    await store.markAllRead();
  }, [store]);

  const dismiss = useCallback(
    async (id: string) => {
      await store.dismiss(id);
    },
    [store]
  );

  const clearAll = useCallback(
    async (clearOptions?: ClearOptions) => {
      await store.clearAll(clearOptions);
    },
    [store]
  );

  const initialize = useCallback(
    async (entryId: string) => {
      await store.initialize(entryId);
    },
    [store]
  );

  return {
    notifications,
    unreadCount: store.getUnreadCount(),
    initialized: state.initialized,
    markRead,
    markAllRead,
    dismiss,
    clearAll,
    initialize,
  };
}

/**
 * Hook for just the unread count (lightweight alternative).
 * Use this when you only need the badge count.
 */
export function useNotificationUnreadCount(): number {
  const store = getNotificationStore();

  // Subscribe to state changes to trigger re-renders
  useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState
  );

  return store.getUnreadCount();
}
