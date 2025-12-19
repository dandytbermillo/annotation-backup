/**
 * Unified Dirty Tracking for Workspace Durability
 *
 * Aggregates dirty state from all durable domains:
 * - Notes/Panels: via workspaceDirtyRef
 * - Components: via workspace component store
 *
 * This is the SINGLE source of truth for "is this workspace dirty?"
 *
 * @see docs/proposal/workspace-state-machine/improvement/2025-12-18-unified-workspace-durability-pipeline.md
 * @see docs/proposal/workspace-state-machine/improvement/2025-12-18-phase0-dirty-sources-audit.md
 */

import type { WorkspaceDirtyState } from './types'
import { workspaceHasDirtyState } from '@/lib/workspace/store-runtime-bridge'
import {
  hasWorkspaceComponentStore,
  getWorkspaceComponentStore,
} from '@/lib/workspace/workspace-component-store'
import { isWorkspaceLifecycleReady } from './lifecycle-manager'
import { debugLog } from '@/lib/utils/debug-logger'

// =============================================================================
// Types
// =============================================================================

/**
 * Reference to workspace-level dirty tracking (notes/panels).
 * This is passed in because it lives in React refs.
 */
export type WorkspaceDirtyRef = {
  current: Map<string, number>
}

// =============================================================================
// Unified Dirty Check
// =============================================================================

/**
 * Check if a workspace has any dirty (unsaved) state.
 *
 * This is the SINGLE function for all dirty checks.
 * Used by:
 * - Hard-safe eviction gating
 * - Persistence scheduler
 * - Degraded mode heuristics
 *
 * @param workspaceId Workspace ID to check
 * @param workspaceDirtyRef Ref to notes/panels dirty tracking (from React hook)
 * @returns true if workspace has unsaved changes in ANY domain
 */
export function isWorkspaceDirty(
  workspaceId: string,
  workspaceDirtyRef?: WorkspaceDirtyRef
): boolean {
  // Domain 1: Components (via store-runtime bridge)
  const componentsDirty = workspaceHasDirtyState(workspaceId)

  // Domain 2: Notes/Panels (via ref from React hook)
  const notesPanelsDirty = workspaceDirtyRef?.current?.has(workspaceId) ?? false

  return componentsDirty || notesPanelsDirty
}

/**
 * Get detailed dirty state for a workspace.
 *
 * Use this when you need more than just a boolean,
 * e.g., for logging or debugging.
 *
 * @param workspaceId Workspace ID to check
 * @param workspaceDirtyRef Ref to notes/panels dirty tracking
 * @returns Detailed dirty state
 */
export function getWorkspaceDirtyState(
  workspaceId: string,
  workspaceDirtyRef?: WorkspaceDirtyRef
): WorkspaceDirtyState {
  // Domain 1: Notes/Panels
  const notesPanelsDirtyAt = workspaceDirtyRef?.current?.get(workspaceId) ?? null
  const notesPanelsDirty = notesPanelsDirtyAt !== null

  // Domain 2: Components
  let componentsDirty = false
  let componentsDirtyIds: string[] = []

  if (hasWorkspaceComponentStore(workspaceId)) {
    const store = getWorkspaceComponentStore(workspaceId)
    componentsDirty = store.hasDirtyState()
    componentsDirtyIds = store.getDirtyIds()
  }

  // Aggregate
  const isDirty = notesPanelsDirty || componentsDirty

  // Find earliest dirty timestamp
  let dirtyAt: number | null = null
  if (notesPanelsDirtyAt !== null) {
    dirtyAt = notesPanelsDirtyAt
  }
  // Component store doesn't track timestamps, so we can't compare

  return {
    isDirty,
    dirtyAt,
    notesPanelsDirty,
    notesPanelsDirtyAt,
    componentsDirty,
    componentsDirtyIds,
  }
}

/**
 * Clear dirty state for a workspace after successful persistence.
 *
 * This should be called after a unified persist succeeds.
 * It clears both domains atomically.
 *
 * @param workspaceId Workspace ID
 * @param workspaceDirtyRef Ref to notes/panels dirty tracking
 */
export function clearWorkspaceDirty(
  workspaceId: string,
  workspaceDirtyRef?: WorkspaceDirtyRef
): void {
  // Clear notes/panels dirty
  workspaceDirtyRef?.current?.delete(workspaceId)

  // Clear components dirty
  if (hasWorkspaceComponentStore(workspaceId)) {
    const store = getWorkspaceComponentStore(workspaceId)
    store.clearDirty()
  }
}

// =============================================================================
// Batch Operations
// =============================================================================

/**
 * Get all dirty workspace IDs.
 *
 * Useful for flush-all scenarios (beforeunload, visibility_hidden).
 *
 * @param workspaceDirtyRef Ref to notes/panels dirty tracking
 * @param knownWorkspaceIds Optional list of workspace IDs to check for component dirty
 * @returns Set of workspace IDs with dirty state
 */
export function getAllDirtyWorkspaceIds(
  workspaceDirtyRef?: WorkspaceDirtyRef,
  knownWorkspaceIds?: string[]
): Set<string> {
  const dirtyIds = new Set<string>()

  // Add all notes/panels dirty workspaces
  if (workspaceDirtyRef?.current) {
    for (const workspaceId of workspaceDirtyRef.current.keys()) {
      dirtyIds.add(workspaceId)
    }
  }

  // Check known workspaces for component dirty
  if (knownWorkspaceIds) {
    for (const workspaceId of knownWorkspaceIds) {
      if (workspaceHasDirtyState(workspaceId)) {
        dirtyIds.add(workspaceId)
      }
    }
  }

  return dirtyIds
}

// =============================================================================
// Phase 4: Lifecycle-Aware Dirty Guard
// =============================================================================

/**
 * Check if dirty-marking is allowed for a workspace.
 *
 * Phase 4 Unified Dirty Model: Dirty should only be set when the workspace
 * lifecycle is 'ready'. This prevents false positives during:
 * - Cold restore (restoring state, not making new changes)
 * - Component remount before hydration starts
 * - Entry re-entry window where refs are fresh
 *
 * @param workspaceId Workspace ID to check
 * @returns true if dirty-marking is allowed, false if it should be skipped
 */
export function shouldAllowDirty(workspaceId: string): boolean {
  // Only allow dirty-marking when lifecycle is 'ready'
  // This means the workspace has been fully restored from DB
  return isWorkspaceLifecycleReady(workspaceId)
}

/**
 * Attempt to set dirty for notes/panels domain with lifecycle guard.
 *
 * This wraps the dirty-setting logic with a lifecycle check.
 * If lifecycle is not 'ready', the dirty flag is NOT set (prevents false positives).
 *
 * @param workspaceId Workspace ID
 * @param workspaceDirtyRef Ref to notes/panels dirty tracking
 * @param source Caller identifier for debugging
 * @returns true if dirty was set, false if blocked by lifecycle guard
 */
export function setWorkspaceDirtyIfAllowed(
  workspaceId: string,
  workspaceDirtyRef: WorkspaceDirtyRef | undefined,
  source: string
): boolean {
  if (!workspaceDirtyRef?.current) return false

  // Check lifecycle guard
  if (!shouldAllowDirty(workspaceId)) {
    void debugLog({
      component: 'DirtyTracking',
      action: 'dirty_blocked_lifecycle',
      metadata: {
        workspaceId,
        source,
        reason: 'workspace_lifecycle_not_ready',
      },
    })
    return false
  }

  // Set dirty if not already set
  if (!workspaceDirtyRef.current.has(workspaceId)) {
    workspaceDirtyRef.current.set(workspaceId, Date.now())
    void debugLog({
      component: 'DirtyTracking',
      action: 'dirty_set',
      metadata: {
        workspaceId,
        source,
        dirtyAt: workspaceDirtyRef.current.get(workspaceId),
      },
    })
  }

  return true
}

/**
 * Check if component dirty-marking is allowed for a workspace.
 *
 * For components, we also need to check lifecycle state.
 * This is called from the component store mutation methods.
 *
 * @param workspaceId Workspace ID
 * @returns true if dirty-marking is allowed
 */
export function shouldAllowComponentDirty(workspaceId: string): boolean {
  return shouldAllowDirty(workspaceId)
}
