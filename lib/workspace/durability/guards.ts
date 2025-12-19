/**
 * Unified Guard Policy for Workspace Durability
 *
 * Implements the guard checks that prevent dangerous persistence operations:
 * - Don't persist during hydration
 * - Don't persist transient mismatch states
 * - Don't attempt revision-constrained writes without a known revision
 *
 * IMPORTANT: `checkPersistGuards` is the CANONICAL guard entrypoint.
 * -----------------------------------------------------------------
 * Currently, persistence functions (`persistWorkspaceById`, `persistWorkspaceNow`)
 * implement equivalent guards inline. Over time, these inline guards should be
 * migrated to call `checkPersistGuards` to prevent policy drift.
 *
 * If you update guard logic, update BOTH:
 * 1. This file (canonical definition)
 * 2. lib/hooks/annotation/workspace/use-workspace-persistence.ts (inline guards)
 *
 * TODO: Wire `checkPersistGuards` into persistence paths to unify guard logic.
 *
 * @see docs/proposal/workspace-state-machine/improvement/2025-12-18-unified-workspace-durability-pipeline.md
 */

import type {
  WorkspaceDurableSnapshot,
  WorkspaceDurabilityLifecycle,
  GuardCheckResult,
  GuardCheckOptions,
  SnapshotSkipReason,
} from './types'
import { isSnapshotInconsistent } from './types'
import { debugLog } from '@/lib/utils/debug-logger'

// =============================================================================
// Configuration
// =============================================================================

/**
 * Guard policy configuration.
 */
export interface GuardPolicyConfig {
  /** How long after hydration to suppress empty persists (ms) */
  postHydrationSuppressMs: number
  /** Whether to allow persisting when revision is unknown */
  allowUnknownRevision: boolean
}

const DEFAULT_CONFIG: GuardPolicyConfig = {
  postHydrationSuppressMs: 2000, // 2 seconds after hydration
  allowUnknownRevision: false,
}

// =============================================================================
// Main Guard Check
// =============================================================================

/**
 * Check if persistence is allowed for a workspace.
 *
 * This is the SINGLE guard entry point for all persistence decisions.
 * Call this before any persist operation.
 *
 * @param options Guard check options
 * @param config Optional config overrides
 * @returns Guard check result
 */
export function checkPersistGuards(
  options: GuardCheckOptions,
  config: Partial<GuardPolicyConfig> = {}
): GuardCheckResult {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }
  const {
    workspaceId,
    snapshot,
    lifecycle,
    revisionKnown,
    recentlyHydrated,
    runtimeInfo,
  } = options

  // --- Guard 1: Lifecycle state ---
  const lifecycleResult = checkLifecycleGuard(lifecycle)
  if (!lifecycleResult.allowed) {
    void debugLog({
      component: 'DurabilityGuards',
      action: 'guard_blocked_lifecycle',
      metadata: {
        workspaceId,
        lifecycle,
        reason: lifecycleResult.reason,
      },
    })
    return lifecycleResult
  }

  // --- Guard 2: Revision known ---
  if (!revisionKnown && !fullConfig.allowUnknownRevision) {
    void debugLog({
      component: 'DurabilityGuards',
      action: 'guard_blocked_revision',
      metadata: {
        workspaceId,
        revisionKnown,
      },
    })
    return {
      allowed: false,
      reason: 'revision_unknown',
    }
  }

  // --- Guard 3: Transient mismatch ---
  const inconsistent = isSnapshotInconsistent(snapshot)
  if (inconsistent) {
    const mismatchResult = handleTransientMismatch(
      workspaceId,
      snapshot,
      runtimeInfo
    )
    if (!mismatchResult.allowed) {
      return mismatchResult
    }
  }

  // --- Guard 4: Empty after load ---
  const isEmpty = isSnapshotEmpty(snapshot)
  if (isEmpty && recentlyHydrated) {
    void debugLog({
      component: 'DurabilityGuards',
      action: 'guard_blocked_empty_after_load',
      metadata: {
        workspaceId,
        openNotesCount: snapshot.openNotes.length,
        panelsCount: snapshot.panels.length,
        componentsCount: snapshot.components.length,
      },
    })
    return {
      allowed: false,
      reason: 'empty_after_load',
    }
  }

  // All guards passed
  return { allowed: true }
}

// =============================================================================
// Individual Guard Checks
// =============================================================================

/**
 * Check lifecycle state guard.
 */
function checkLifecycleGuard(lifecycle: WorkspaceDurabilityLifecycle): GuardCheckResult {
  switch (lifecycle) {
    case 'uninitialized':
    case 'restoring':
      return {
        allowed: false,
        reason: 'lifecycle_not_ready',
      }

    case 'ready':
    case 'persisting':
      return { allowed: true }

    case 'degraded':
      // Degraded mode allows persistence (we want to try to recover)
      return { allowed: true }

    default:
      return { allowed: true }
  }
}

/**
 * Handle transient mismatch scenario.
 *
 * When panels > 0 but openNotes = 0 (or similar inconsistencies),
 * we should either:
 * 1. Block if runtime confirms we should have notes
 * 2. Allow if runtime also shows empty (consistent empty state)
 */
function handleTransientMismatch(
  workspaceId: string,
  snapshot: WorkspaceDurableSnapshot,
  runtimeInfo?: GuardCheckOptions['runtimeInfo']
): GuardCheckResult {
  const mismatchDetails = {
    openNotesCount: snapshot.openNotes.length,
    panelsCount: snapshot.panels.length,
    componentsCount: snapshot.components.length,
    hasRuntime: runtimeInfo?.hasRuntime ?? false,
  }

  // If runtime has notes but snapshot doesn't, this is a transient state
  if (runtimeInfo?.hasRuntime && runtimeInfo.runtimeOpenNotesCount > 0) {
    if (snapshot.openNotes.length === 0) {
      void debugLog({
        component: 'DurabilityGuards',
        action: 'guard_blocked_transient_mismatch',
        metadata: {
          workspaceId,
          snapshotOpenNotes: snapshot.openNotes.length,
          runtimeOpenNotes: runtimeInfo.runtimeOpenNotesCount,
          panels: snapshot.panels.length,
        },
      })
      return {
        allowed: false,
        reason: 'transient_mismatch',
        mismatchDetails,
      }
    }
  }

  // Panels exist but no openNotes - always suspicious
  if (snapshot.panels.length > 0 && snapshot.openNotes.length === 0) {
    void debugLog({
      component: 'DurabilityGuards',
      action: 'guard_blocked_panels_without_notes',
      metadata: {
        workspaceId,
        panelsCount: snapshot.panels.length,
        openNotesCount: 0,
      },
    })
    return {
      allowed: false,
      reason: 'transient_mismatch',
      mismatchDetails,
    }
  }

  // Other inconsistencies - log but allow (may be valid edge cases)
  void debugLog({
    component: 'DurabilityGuards',
    action: 'guard_warning_inconsistent_allowed',
    metadata: {
      workspaceId,
      ...mismatchDetails,
    },
  })
  return { allowed: true }
}

/**
 * Check if snapshot is completely empty.
 */
function isSnapshotEmpty(snapshot: WorkspaceDurableSnapshot): boolean {
  return (
    snapshot.openNotes.length === 0 &&
    snapshot.panels.length === 0 &&
    snapshot.components.length === 0
  )
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a persist should be retried based on guard result.
 */
export function shouldRetryPersist(result: GuardCheckResult): boolean {
  if (result.allowed) return false

  // These are transient conditions worth retrying
  const retriableReasons: SnapshotSkipReason[] = [
    'lifecycle_not_ready',
    'hydrating',
    'transient_mismatch',
  ]

  return result.reason !== undefined && retriableReasons.includes(result.reason)
}

/**
 * Check if a guard failure should trigger degraded mode.
 */
export function shouldEnterDegradedMode(
  result: GuardCheckResult,
  consecutiveFailures: number
): boolean {
  // Only revision_unknown failures after multiple retries indicate a real problem
  if (result.reason === 'revision_unknown' && consecutiveFailures >= 3) {
    return true
  }

  // Transient mismatches that persist for many cycles indicate corruption
  if (result.reason === 'transient_mismatch' && consecutiveFailures >= 5) {
    return true
  }

  return false
}

/**
 * Create runtime info from current workspace state.
 * Helper for constructing GuardCheckOptions.
 */
export function createRuntimeInfo(
  hasRuntime: boolean,
  openNotesCount: number,
  membershipCount: number
): GuardCheckOptions['runtimeInfo'] {
  return {
    hasRuntime,
    runtimeOpenNotesCount: openNotesCount,
    runtimeMembershipCount: membershipCount,
  }
}
