/**
 * Notification Center
 *
 * Local-first notification system for workspace events.
 *
 * Usage:
 * ```typescript
 * import {
 *   getNotificationStore,
 *   emitNotification,
 *   createDedupeKey,
 * } from '@/lib/notification-center';
 *
 * // Emit a notification (for producers)
 * await emitNotification({
 *   entryId: 'abc123',
 *   severity: 'error',
 *   category: 'eviction',
 *   title: 'Eviction blocked',
 *   description: 'Changes could not be saved.',
 *   dedupeKey: createDedupeKey({
 *     type: 'eviction_blocked',
 *     entryId: 'abc123',
 *     workspaceId: 'ws456',
 *   }),
 * });
 *
 * // In React components, use the hook
 * import { useNotificationCenter } from '@/hooks/use-notification-center';
 *
 * function MyComponent() {
 *   const { notifications, unreadCount, markRead, dismiss } = useNotificationCenter();
 *   // ...
 * }
 * ```
 */

// Types
export type {
  Notification,
  NotificationEvent,
  NotificationSeverity,
  NotificationCategory,
  NotificationStore,
  NotificationStoreState,
  NotificationStoreListener,
  NotificationStorageAdapter,
  RetentionPolicy,
  ClearOptions,
  NotificationFilter,
  NotificationPanelState,
} from './types';

// Store
export {
  getNotificationStore,
  emitNotification,
  createDedupeKey,
} from './notification-store';

// Adapter (for advanced use / testing)
export {
  IndexedDBNotificationAdapter,
  getNotificationStorageAdapter,
} from './indexeddb-adapter';

// Workspace integration
export {
  registerWorkspaceNotificationListeners,
  unregisterWorkspaceNotificationListeners,
  emitDegradedModeNotification,
  emitPersistFailureNotification,
  emitRecoveryNotification,
} from './workspace-integration';
