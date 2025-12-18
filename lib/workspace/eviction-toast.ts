/**
 * Eviction Toast Notifications
 * Part of Hard-Safe 4-Cap Eviction - Gap 2 Fix
 *
 * Provides toast notification utilities for eviction-related events.
 * Shows user-facing notifications when eviction is blocked due to persist failures.
 */

import { toast } from "@/hooks/use-toast"
import type { EvictionBlockedCallback } from "./runtime-manager"

/**
 * Show toast when eviction is blocked due to persist failure (dirty state couldn't be saved).
 *
 * @param workspaceId Workspace ID that couldn't be evicted
 * @param reason The reason eviction was attempted
 */
export function showEvictionBlockedPersistFailedToast(
  workspaceId: string,
  reason: string
): void {
  toast({
    title: "Workspace save failed",
    description: `Unable to switch workspaces. The current workspace has unsaved changes that couldn't be persisted. Please try again or check your connection.`,
    variant: "destructive",
  })
}

/**
 * Show toast when eviction is blocked due to active operations (timers, etc.).
 *
 * @param workspaceId Workspace ID with active operations
 * @param activeOperationCount Number of active operations
 */
export function showEvictionBlockedActiveOpsToast(
  workspaceId: string,
  activeOperationCount: number
): void {
  // If activeOperationCount is 0, it means ALL workspaces have active operations
  // (the "all busy" scenario where no eviction candidate was found)
  if (activeOperationCount === 0) {
    toast({
      title: "All workspaces are busy",
      description: "Cannot open new workspace - all existing workspaces have running operations (e.g., timers). Stop some timers first.",
      variant: "default",
    })
    return
  }

  toast({
    title: "Workspace has running operations",
    description: `Cannot close workspace - ${activeOperationCount} operation(s) still running (e.g., timers). Stop them first or force close.`,
    variant: "default",
  })
}

/**
 * Show toast when system enters degraded mode (too many consecutive persist failures).
 */
export function showDegradedModeToast(): void {
  toast({
    title: "Workspace system degraded",
    description: "Multiple save failures detected. New workspaces cannot be opened until the issue is resolved.",
    variant: "destructive",
  })
}

/**
 * Handler for eviction blocked callbacks that shows appropriate toasts.
 * Use this with registerEvictionBlockedListener.
 *
 * @example
 * ```ts
 * import { registerEvictionBlockedListener } from '@/lib/workspace/store-runtime-bridge'
 * import { handleEvictionBlockedToast } from '@/lib/workspace/eviction-toast'
 *
 * // In initialization:
 * registerEvictionBlockedListener(handleEvictionBlockedToast)
 * ```
 */
export const handleEvictionBlockedToast: EvictionBlockedCallback = (payload) => {
  const { workspaceId, activeOperationCount, reason, blockType } = payload

  if (blockType === "persist_failed") {
    showEvictionBlockedPersistFailedToast(workspaceId, reason)
  } else if (blockType === "active_operations") {
    showEvictionBlockedActiveOpsToast(workspaceId, activeOperationCount)
  }
}
