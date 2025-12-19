/**
 * Workspace Durability Lifecycle Manager
 *
 * Tracks the unified lifecycle state for each workspace.
 * This is the SINGLE source of truth for whether a workspace
 * is fully restored and ready for persistence operations.
 *
 * Lifecycle states:
 * - uninitialized: Workspace created but not yet loaded
 * - restoring: Loading from DB, persistence blocked
 * - ready: Fully restored, safe to persist/evict
 * - persisting: Currently persisting, reads allowed
 * - degraded: Persistent failures, cold opens blocked
 *
 * @see docs/proposal/workspace-state-machine/improvement/2025-12-18-unified-workspace-durability-pipeline.md
 */

import type {
  WorkspaceDurabilityLifecycle,
  WorkspaceLifecycleState,
} from './types'
import { debugLog } from '@/lib/utils/debug-logger'

// =============================================================================
// State Storage
// =============================================================================

/**
 * Per-workspace lifecycle state.
 * Key: workspaceId, Value: lifecycle state with metadata
 */
const workspaceLifecycles = new Map<string, WorkspaceLifecycleState>()

// =============================================================================
// Lifecycle State Access
// =============================================================================

/**
 * Get the lifecycle state for a workspace.
 *
 * @param workspaceId Workspace ID
 * @returns Lifecycle state, or 'uninitialized' if not tracked
 */
export function getWorkspaceLifecycle(
  workspaceId: string
): WorkspaceDurabilityLifecycle {
  return workspaceLifecycles.get(workspaceId)?.lifecycle ?? 'uninitialized'
}

/**
 * Get detailed lifecycle state for a workspace.
 *
 * @param workspaceId Workspace ID
 * @returns Full lifecycle state with metadata, or default uninitialized state
 */
export function getWorkspaceLifecycleState(
  workspaceId: string
): WorkspaceLifecycleState {
  return workspaceLifecycles.get(workspaceId) ?? {
    lifecycle: 'uninitialized',
    enteredAt: 0,
  }
}

/**
 * Check if a workspace is in 'ready' state (fully restored, safe to persist).
 *
 * This is the PRIMARY check for hot/cold classification:
 * - ready = hot restore (skip DB load, use in-memory state)
 * - not ready = cold restore (load from DB)
 *
 * @param workspaceId Workspace ID
 * @returns true if workspace lifecycle is 'ready'
 */
export function isWorkspaceLifecycleReady(workspaceId: string): boolean {
  const lifecycle = getWorkspaceLifecycle(workspaceId)
  return lifecycle === 'ready'
}

/**
 * Check if a workspace is currently restoring (loading from DB).
 *
 * During restoring, persistence operations should be blocked.
 *
 * @param workspaceId Workspace ID
 * @returns true if workspace is in 'restoring' state
 */
export function isWorkspaceRestoring(workspaceId: string): boolean {
  return getWorkspaceLifecycle(workspaceId) === 'restoring'
}

/**
 * Check if a workspace is in degraded mode.
 *
 * @param workspaceId Workspace ID
 * @returns true if workspace is in 'degraded' state
 */
export function isWorkspaceInDegradedMode(workspaceId: string): boolean {
  return getWorkspaceLifecycle(workspaceId) === 'degraded'
}

// =============================================================================
// Lifecycle State Transitions
// =============================================================================

/**
 * Set the lifecycle state for a workspace.
 * Logs the transition for debugging.
 *
 * @param workspaceId Workspace ID
 * @param lifecycle New lifecycle state
 * @param source Caller identifier for debugging
 * @param metadata Optional additional metadata
 */
export function setWorkspaceLifecycle(
  workspaceId: string,
  lifecycle: WorkspaceDurabilityLifecycle,
  source: string,
  metadata?: Record<string, unknown>
): void {
  const prevState = workspaceLifecycles.get(workspaceId)
  const prevLifecycle = prevState?.lifecycle ?? 'uninitialized'

  // Don't log if no change
  if (prevLifecycle === lifecycle) return

  const now = Date.now()
  const newState: WorkspaceLifecycleState = {
    lifecycle,
    enteredAt: now,
  }

  // Preserve degraded mode metadata if transitioning to/from degraded
  if (lifecycle === 'degraded') {
    newState.degradedSince = now
    newState.failureCount = (prevState?.failureCount ?? 0) + 1
  } else if (prevState?.failureCount) {
    // Clear failure count when leaving degraded-related states
    // (but only if transitioning to ready - keep count during restoring)
    if (lifecycle === 'ready') {
      newState.failureCount = 0
    } else {
      newState.failureCount = prevState.failureCount
    }
  }

  workspaceLifecycles.set(workspaceId, newState)

  void debugLog({
    component: 'DurabilityLifecycle',
    action: 'lifecycle_transition',
    metadata: {
      workspaceId,
      source,
      prevLifecycle,
      newLifecycle: lifecycle,
      enteredAt: now,
      ...metadata,
    },
  })
}

/**
 * Transition a workspace to 'restoring' state.
 * Call this at the START of hydration (before loading from DB).
 *
 * @param workspaceId Workspace ID
 * @param source Caller identifier
 */
export function beginWorkspaceRestore(
  workspaceId: string,
  source: string
): void {
  setWorkspaceLifecycle(workspaceId, 'restoring', source, {
    action: 'begin_restore',
  })
}

/**
 * Transition a workspace to 'ready' state.
 * Call this at the END of hydration (after both domains are restored).
 *
 * @param workspaceId Workspace ID
 * @param source Caller identifier
 */
export function completeWorkspaceRestore(
  workspaceId: string,
  source: string
): void {
  setWorkspaceLifecycle(workspaceId, 'ready', source, {
    action: 'complete_restore',
  })
}

/**
 * Transition a workspace to 'persisting' state.
 * Call this at the START of a persist operation.
 *
 * @param workspaceId Workspace ID
 * @param source Caller identifier
 */
export function beginWorkspacePersist(
  workspaceId: string,
  source: string
): void {
  setWorkspaceLifecycle(workspaceId, 'persisting', source, {
    action: 'begin_persist',
  })
}

/**
 * Return a workspace to 'ready' state after persisting.
 * Call this at the END of a persist operation.
 *
 * @param workspaceId Workspace ID
 * @param source Caller identifier
 * @param success Whether the persist succeeded
 */
export function completeWorkspacePersist(
  workspaceId: string,
  source: string,
  success: boolean
): void {
  // If persist failed, may transition to degraded (handled by caller with failure count)
  setWorkspaceLifecycle(workspaceId, 'ready', source, {
    action: 'complete_persist',
    success,
  })
}

/**
 * Transition a workspace to 'degraded' state.
 * Call this after consecutive persist failures exceed threshold.
 *
 * @param workspaceId Workspace ID
 * @param source Caller identifier
 * @param failureCount Number of consecutive failures
 */
export function enterDegradedMode(
  workspaceId: string,
  source: string,
  failureCount: number
): void {
  const prevState = workspaceLifecycles.get(workspaceId)
  const newState: WorkspaceLifecycleState = {
    lifecycle: 'degraded',
    enteredAt: Date.now(),
    failureCount,
    degradedSince: prevState?.degradedSince ?? Date.now(),
  }
  workspaceLifecycles.set(workspaceId, newState)

  void debugLog({
    component: 'DurabilityLifecycle',
    action: 'enter_degraded_mode',
    metadata: {
      workspaceId,
      source,
      failureCount,
      degradedSince: newState.degradedSince,
    },
  })
}

/**
 * Exit degraded mode and return to ready state.
 * Call this after user action (successful retry or force close).
 *
 * @param workspaceId Workspace ID
 * @param source Caller identifier
 */
export function exitDegradedMode(
  workspaceId: string,
  source: string
): void {
  setWorkspaceLifecycle(workspaceId, 'ready', source, {
    action: 'exit_degraded_mode',
  })
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Remove lifecycle tracking for a workspace.
 * Call this when a workspace runtime is evicted.
 *
 * @param workspaceId Workspace ID
 */
export function removeWorkspaceLifecycle(workspaceId: string): void {
  const prevState = workspaceLifecycles.get(workspaceId)
  if (prevState) {
    workspaceLifecycles.delete(workspaceId)
    void debugLog({
      component: 'DurabilityLifecycle',
      action: 'lifecycle_removed',
      metadata: {
        workspaceId,
        prevLifecycle: prevState.lifecycle,
      },
    })
  }
}

/**
 * Get all workspaces in a specific lifecycle state.
 *
 * @param lifecycle Target lifecycle state
 * @returns Array of workspace IDs
 */
export function getWorkspacesByLifecycle(
  lifecycle: WorkspaceDurabilityLifecycle
): string[] {
  const result: string[] = []
  workspaceLifecycles.forEach((state, workspaceId) => {
    if (state.lifecycle === lifecycle) {
      result.push(workspaceId)
    }
  })
  return result
}

/**
 * Get all tracked workspaces with their lifecycle states.
 * Useful for debugging.
 *
 * @returns Map of workspace ID to lifecycle state
 */
export function getAllWorkspaceLifecycles(): Map<string, WorkspaceLifecycleState> {
  return new Map(workspaceLifecycles)
}
