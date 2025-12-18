/**
 * Workspace Integration for Notification Center
 *
 * Connects workspace events (eviction blocked, degraded mode, persist failed)
 * to the notification center for durable history.
 */

import {
  registerEvictionBlockedCallback,
  unregisterEvictionBlockedCallback,
} from '@/lib/workspace/runtime-manager';
import { emitNotification, createDedupeKey } from './notification-store';
import type { NotificationCategory, NotificationSeverity } from './types';

// Track if integration is already registered
let integrationRegistered = false;

/**
 * Eviction blocked callback handler.
 * Emits a durable notification when eviction is blocked.
 */
function handleEvictionBlocked({
  workspaceId,
  entryId,
  activeOperationCount,
  reason,
  blockType,
}: {
  workspaceId: string;
  entryId: string | null;
  activeOperationCount: number;
  reason: string;
  blockType: 'active_operations' | 'persist_failed';
}): void {
  // Need entryId to emit notification
  if (!entryId) {
    console.warn(
      '[NotificationCenter] Cannot emit eviction blocked notification: no entryId',
      { workspaceId, reason, blockType }
    );
    return;
  }

  let title: string;
  let description: string;
  let severity: NotificationSeverity;
  let category: NotificationCategory;
  let dedupeKey: string;
  let details: Record<string, unknown> | null = null;

  if (blockType === 'persist_failed') {
    title = 'Workspace save failed';
    description = 'Changes could not be saved. The workspace was kept open to prevent data loss.';
    severity = 'error';
    category = 'persistence';
    dedupeKey = createDedupeKey({
      type: 'eviction_blocked',
      entryId,
      workspaceId,
    });
    details = {
      'What happened': 'Save operation failed while trying to switch workspaces',
      'Action needed': 'Check your network connection and try again',
    };
  } else {
    // active_operations
    const operationText = activeOperationCount === 1
      ? '1 operation is'
      : `${activeOperationCount || 'Operations are'}`;
    title = 'All workspaces busy';
    description = `Cannot open new workspace. ${operationText} running (e.g., timers). Stop an operation first.`;
    severity = 'warning';
    category = 'eviction';
    dedupeKey = createDedupeKey({
      type: 'custom',
      key: `entry:${entryId}:all_workspaces_busy`,
    });
    details = {
      'Why this happened': 'All 4 workspace slots have active operations',
      'How to fix': 'Stop a timer or close a workspace with running tasks',
    };
  }

  // Emit notification (async but we don't need to wait)
  emitNotification({
    entryId,
    workspaceId,
    severity,
    category,
    title,
    description,
    dedupeKey,
    details,
  }).catch((error) => {
    console.error('[NotificationCenter] Failed to emit eviction notification:', error);
  });
}

/**
 * Register workspace event listeners for notification center.
 * Should be called once during app initialization.
 */
export function registerWorkspaceNotificationListeners(): void {
  if (integrationRegistered) {
    return;
  }

  registerEvictionBlockedCallback(handleEvictionBlocked);
  integrationRegistered = true;

  if (process.env.NODE_ENV === 'development') {
    console.log('[NotificationCenter] Workspace integration registered');
  }
}

/**
 * Unregister workspace event listeners.
 * Should be called during app cleanup (if needed).
 */
export function unregisterWorkspaceNotificationListeners(): void {
  if (!integrationRegistered) {
    return;
  }

  unregisterEvictionBlockedCallback(handleEvictionBlocked);
  integrationRegistered = false;

  if (process.env.NODE_ENV === 'development') {
    console.log('[NotificationCenter] Workspace integration unregistered');
  }
}

/**
 * Emit a degraded mode notification.
 * Call this when the system enters degraded mode.
 */
export async function emitDegradedModeNotification(
  entryId: string,
  consecutiveFailures: number
): Promise<void> {
  await emitNotification({
    entryId,
    severity: 'error',
    category: 'system',
    title: 'System in degraded mode',
    description: `${consecutiveFailures} consecutive save failures occurred. Opening new workspaces is temporarily blocked.`,
    dedupeKey: createDedupeKey({
      type: 'degraded_mode_entered',
      entryId,
    }),
    details: {
      'What happened': `${consecutiveFailures} save attempts failed in a row`,
      'Why blocked': 'To prevent losing unsaved work, new workspace opens are paused',
      'How to fix': 'Click the Retry button in the degraded mode banner when ready',
    },
  });
}

/**
 * Emit a persist failure notification.
 * Call this when a workspace persist operation fails.
 */
export async function emitPersistFailureNotification(
  entryId: string,
  workspaceId: string,
  error?: string
): Promise<void> {
  await emitNotification({
    entryId,
    workspaceId,
    severity: 'error',
    category: 'persistence',
    title: 'Workspace save failed',
    description: 'Your changes could not be saved. They are still in memory.',
    dedupeKey: createDedupeKey({
      type: 'persist_failed',
      entryId,
      workspaceId,
    }),
    details: error ? {
      'Error': error,
      'Your changes': 'Still in memory - do not close the browser',
      'Action': 'Check your connection and try saving again',
    } : {
      'Your changes': 'Still in memory - do not close the browser',
      'Action': 'Check your connection and try saving again',
    },
  });
}

/**
 * Emit a recovery notification.
 * Call this when the system recovers from degraded mode or persist failures.
 */
export async function emitRecoveryNotification(
  entryId: string,
  recoveryType: 'degraded_mode' | 'persist'
): Promise<void> {
  await emitNotification({
    entryId,
    severity: 'success',
    category: 'system',
    title: recoveryType === 'degraded_mode' ? 'System recovered' : 'Save restored',
    description:
      recoveryType === 'degraded_mode'
        ? 'Degraded mode has been cleared. Normal operation resumed.'
        : 'Workspace saving is working again.',
    // No dedupe key for recovery - we want each recovery to show
  });
}
