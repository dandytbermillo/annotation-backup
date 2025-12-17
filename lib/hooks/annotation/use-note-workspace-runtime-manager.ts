import { useCallback, useRef, useState } from "react"

import {
  getWorkspaceRuntime,
  hasWorkspaceRuntime,
  listWorkspaceRuntimeIds,
  removeWorkspaceRuntime,
  notifyEvictionBlockedPersistFailed,
  getLeastRecentlyVisibleRuntimeId,
  getActiveOperationCount,
  isWorkspacePinned,
} from "@/lib/workspace/runtime-manager"

// Gap 4 fix: Shared workspace ID (matches SHARED_WORKSPACE_ID_INTERNAL in runtime-manager)
const SHARED_WORKSPACE_ID = "__workspace__"
import { workspaceHasDirtyState } from "@/lib/workspace/store-runtime-bridge"

// =============================================================================
// Types
// =============================================================================

export type EvictionResult =
  | { evicted: true }
  | { evicted: false; blocked: true; reason: "persist_failed_dirty"; workspaceId: string }
  | { evicted: false; blocked: false; reason: "not_found" | "is_current" | "disabled" }

export type NoteWorkspaceDebugLogger = (event: {
  component: string
  action: string
  content_preview?: string
  metadata?: Record<string, unknown>
  note_id?: string | null
}) => void | Promise<void>

type RuntimeManagerOptions = {
  liveStateEnabled: boolean
  currentWorkspaceId: string | null
  pendingWorkspaceId: string | null
  runtimeCapacity: number
  captureSnapshot: (
    workspaceId?: string | null,
    options?: { readinessReason?: string; readinessMaxWaitMs?: number; skipReadiness?: boolean },
  ) => Promise<void>
  persistSnapshot: (workspaceId: string | null | undefined, reason: string) => Promise<boolean>
  emitDebugLog?: NoteWorkspaceDebugLogger
  /** Gap 1 fix: Additional dirty check ref for workspace-level dirty state (panels, openNotes, etc.) */
  workspaceDirtyRef?: React.MutableRefObject<Map<string, number>>
}

export type EnsureRuntimeResult =
  | { ok: true }
  | { ok: false; blocked: true; blockedWorkspaceId: string }

// Phase 3: Bounded backpressure configuration
const CONSECUTIVE_FAILURE_THRESHOLD = 3

export type NoteWorkspaceRuntimeManagerResult = {
  ensureRuntimePrepared: (workspaceId: string | null | undefined, reason: string) => Promise<EnsureRuntimeResult>
  updateRuntimeAccess: (workspaceId: string | null | undefined) => void
  runtimeAccessRef: React.MutableRefObject<Map<string, number>>
  /** Phase 3: Whether the system is in degraded mode due to consecutive persist failures */
  isDegradedMode: boolean
  /** Phase 3: Reset degraded mode after user action (e.g., successful retry or force close) */
  resetDegradedMode: () => void
}

export function useNoteWorkspaceRuntimeManager({
  liveStateEnabled,
  currentWorkspaceId,
  pendingWorkspaceId,
  runtimeCapacity,
  captureSnapshot,
  persistSnapshot,
  emitDebugLog,
  workspaceDirtyRef,
}: RuntimeManagerOptions): NoteWorkspaceRuntimeManagerResult {
  const runtimeAccessRef = useRef<Map<string, number>>(new Map())

  // Phase 3: Track consecutive persist failures for bounded backpressure
  const [consecutiveFailures, setConsecutiveFailures] = useState(0)
  const isDegradedMode = consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD

  const resetDegradedMode = useCallback(() => {
    setConsecutiveFailures(0)
    emitDebugLog?.({
      component: "NoteWorkspaceRuntime",
      action: "degraded_mode_reset",
      metadata: { previousFailures: consecutiveFailures },
    })
  }, [consecutiveFailures, emitDebugLog])

  // CRITICAL: Use refs to avoid stale closure issues during eviction.
  //
  // Problem: During workspace switches, React re-renders and creates new versions of
  // captureSnapshot/persistSnapshot (because their dependencies like currentWorkspaceId change).
  // If evictWorkspaceRuntime captures these functions in its closure and is called before
  // React finishes propagating updates, it calls STALE versions that may not work correctly.
  //
  // Symptom: workspace_runtime_eviction_start/evicted logs appear (they use the workspaceId
  // parameter directly), but persist_by_id_* logs are missing (persistSnapshot returns early).
  //
  // Solution: Store functions in refs, update refs synchronously each render, and access
  // via refs in evictWorkspaceRuntime. This ensures we always call the LATEST versions.
  const captureSnapshotRef = useRef(captureSnapshot)
  const persistSnapshotRef = useRef(persistSnapshot)
  const emitDebugLogRef = useRef(emitDebugLog)

  // Keep refs updated synchronously every render
  captureSnapshotRef.current = captureSnapshot
  persistSnapshotRef.current = persistSnapshot
  emitDebugLogRef.current = emitDebugLog

  const updateRuntimeAccess = useCallback(
    (workspaceId: string | null | undefined) => {
      if (!liveStateEnabled || !workspaceId) return
      runtimeAccessRef.current.set(workspaceId, Date.now())
    },
    [liveStateEnabled],
  )

  const evictWorkspaceRuntime = useCallback(
    async (workspaceId: string | null | undefined, reason: string): Promise<EvictionResult> => {
      if (!liveStateEnabled || !workspaceId) {
        return { evicted: false, blocked: false, reason: "disabled" }
      }
      if (!hasWorkspaceRuntime(workspaceId)) {
        return { evicted: false, blocked: false, reason: "not_found" }
      }
      if (workspaceId === currentWorkspaceId) {
        return { evicted: false, blocked: false, reason: "is_current" }
      }

      // Capture the workspaceId in a const to ensure it doesn't change during async operations
      const targetWorkspaceId = workspaceId

      // Get LATEST functions via refs (avoiding stale closures)
      const logFn = emitDebugLogRef.current
      const captureFn = captureSnapshotRef.current

      // Check if workspace has dirty (unsaved) state BEFORE eviction attempt
      // Gap 1 fix: Check BOTH component store dirty state AND workspace-level dirty state
      const componentStoreDirty = workspaceHasDirtyState(targetWorkspaceId)
      const workspaceLevelDirty = workspaceDirtyRef?.current?.has(targetWorkspaceId) ?? false
      const isDirty = componentStoreDirty || workspaceLevelDirty

      logFn?.({
        component: "NoteWorkspaceRuntime",
        action: "workspace_runtime_eviction_start",
        metadata: {
          workspaceId: targetWorkspaceId,
          reason,
          isDirty,
          componentStoreDirty,
          workspaceLevelDirty,
          runtimeCount: listWorkspaceRuntimeIds().length,
        },
      })

      // Capture snapshot using LATEST function
      await captureFn(targetWorkspaceId, {
        readinessReason: `evict_${reason}`,
        readinessMaxWaitMs: 0,
        skipReadiness: true,
      })

      // Persist using LATEST function - re-read ref in case it changed during capture await
      const latestPersistFn = persistSnapshotRef.current
      const persistResult = await latestPersistFn(targetWorkspaceId, reason)

      // Log persist result for debugging
      emitDebugLogRef.current?.({
        component: "NoteWorkspaceRuntime",
        action: "workspace_runtime_eviction_persist_result",
        metadata: {
          workspaceId: targetWorkspaceId,
          reason,
          persistResult,
          isDirty,
        },
      })

      // HARD-SAFE EVICTION: Only block if dirty AND persist failed
      // If not dirty, eviction is safe even if persist returned false (nothing to lose)
      if (!persistResult && isDirty) {
        // Phase 3: Increment consecutive failure counter for bounded backpressure
        setConsecutiveFailures((prev) => {
          const newCount = prev + 1
          emitDebugLogRef.current?.({
            component: "NoteWorkspaceRuntime",
            action: "consecutive_persist_failure",
            metadata: {
              workspaceId: targetWorkspaceId,
              previousFailures: prev,
              newFailures: newCount,
              threshold: CONSECUTIVE_FAILURE_THRESHOLD,
              isDegradedMode: newCount >= CONSECUTIVE_FAILURE_THRESHOLD,
            },
          })
          return newCount
        })
        emitDebugLogRef.current?.({
          component: "NoteWorkspaceRuntime",
          action: "workspace_runtime_eviction_blocked_persist_failed",
          metadata: {
            workspaceId: targetWorkspaceId,
            reason,
            persistResult,
            isDirty,
            runtimeCount: listWorkspaceRuntimeIds().length,
          },
        })
        // Phase 2: Notify UI about blocked eviction so user can decide (retry/force/cancel)
        notifyEvictionBlockedPersistFailed(targetWorkspaceId, reason)
        return { evicted: false, blocked: true, reason: "persist_failed_dirty", workspaceId: targetWorkspaceId }
      }

      // Phase 3: Reset consecutive failures on successful eviction
      setConsecutiveFailures(0)

      // Safe to evict: either persist succeeded or workspace wasn't dirty
      removeWorkspaceRuntime(targetWorkspaceId)
      runtimeAccessRef.current.delete(targetWorkspaceId)

      // Get LATEST logFn for completion log
      const latestLogFn = emitDebugLogRef.current
      latestLogFn?.({
        component: "NoteWorkspaceRuntime",
        action: "workspace_runtime_evicted",
        metadata: {
          workspaceId: targetWorkspaceId,
          reason,
          persistResult,
          isDirty,
          runtimeCount: listWorkspaceRuntimeIds().length,
        },
      })
      return { evicted: true }
    },
    // Note: We intentionally DO NOT include captureSnapshot, persistSnapshot, or emitDebugLog
    // in the dependency array. The function uses refs to access the latest versions, so it
    // doesn't need to be recreated when these functions change. This prevents the stale
    // closure issue that was causing eviction to fail to persist.
    [currentWorkspaceId, liveStateEnabled],
  )

  const ensureRuntimePrepared = useCallback(
    async (workspaceId: string | null | undefined, reason: string): Promise<{ ok: true } | { ok: false; blocked: true; blockedWorkspaceId: string }> => {
      if (!liveStateEnabled || !workspaceId) return { ok: true }

      // Phase 3: Block workspace opening when in degraded mode (too many consecutive persist failures)
      if (isDegradedMode) {
        emitDebugLogRef.current?.({
          component: "NoteWorkspaceRuntime",
          action: "workspace_open_blocked_degraded_mode",
          metadata: {
            requestedWorkspaceId: workspaceId,
            reason,
            consecutiveFailures,
            threshold: CONSECUTIVE_FAILURE_THRESHOLD,
          },
        })
        // UI shows degraded banner via isDegradedMode state (see DegradedModeBanner component)
        // Return blocked with empty workspaceId to indicate degraded mode block (not a specific workspace)
        return { ok: false, blocked: true, blockedWorkspaceId: "" }
      }

      updateRuntimeAccess(workspaceId)
      if (!hasWorkspaceRuntime(workspaceId)) {
        const runtimeIds = listWorkspaceRuntimeIds()
        if (runtimeIds.length >= runtimeCapacity) {
          // Phase 4: Use runtime-manager's eligibility rules for candidate selection
          // getLeastRecentlyVisibleRuntimeId already excludes:
          // - visible runtimes
          // - shared/placeholder workspace
          // - pinned workspaces
          // - workspaces with active operations
          let candidate = getLeastRecentlyVisibleRuntimeId()

          // Additional safety: ensure we don't evict current/pending workspaces
          // even if they aren't marked as visible yet (race condition protection)
          const excludeIds = new Set<string>([workspaceId])
          if (currentWorkspaceId) excludeIds.add(currentWorkspaceId)
          if (pendingWorkspaceId) excludeIds.add(pendingWorkspaceId)

          // If the candidate is in exclude list, try to find another one
          // by falling back to LRU from our access tracking (excluding protected ones)
          if (candidate && excludeIds.has(candidate)) {
            emitDebugLogRef.current?.({
              component: "NoteWorkspaceRuntime",
              action: "eviction_candidate_protected",
              metadata: {
                candidate,
                currentWorkspaceId,
                pendingWorkspaceId,
                requestedWorkspaceId: workspaceId,
              },
            })
            candidate = null // Fall through to fallback selection
          }

          // Fallback: if runtime-manager didn't find a candidate, try LRU from access tracking
          if (!candidate) {
            let oldest = Number.POSITIVE_INFINITY
            runtimeIds.forEach((id) => {
              if (excludeIds.has(id)) return
              // Gap 4 fix: Skip shared workspace (placeholder)
              if (id === SHARED_WORKSPACE_ID) return
              // Gap 4 fix: Skip pinned workspaces (protected from eviction)
              if (isWorkspacePinned(id)) return
              // Phase 4: Also skip workspaces with active operations
              if (getActiveOperationCount(id) > 0) return
              const ts = runtimeAccessRef.current.get(id) ?? 0
              if (ts < oldest) {
                oldest = ts
                candidate = id
              }
            })
          }

          if (candidate) {
            const evictionResult = await evictWorkspaceRuntime(candidate, "capacity")

            // HARD-SAFE: If eviction was blocked, do NOT create a new runtime
            // This prevents silent data loss and exceeding capacity with dirty workspaces
            if (!evictionResult.evicted && evictionResult.blocked) {
              emitDebugLogRef.current?.({
                component: "NoteWorkspaceRuntime",
                action: "workspace_runtime_creation_blocked",
                metadata: {
                  requestedWorkspaceId: workspaceId,
                  blockedWorkspaceId: evictionResult.workspaceId,
                  reason: evictionResult.reason,
                  runtimeCount: listWorkspaceRuntimeIds().length,
                  runtimeCapacity,
                },
              })
              return { ok: false, blocked: true, blockedWorkspaceId: evictionResult.workspaceId }
            }
          }
        }
        if (!hasWorkspaceRuntime(workspaceId)) {
          getWorkspaceRuntime(workspaceId)
          runtimeAccessRef.current.set(workspaceId, Date.now())
          // Use ref for logging to ensure we get the latest version
          emitDebugLogRef.current?.({
            component: "NoteWorkspaceRuntime",
            action: "workspace_runtime_created",
            metadata: {
              workspaceId,
              reason,
              runtimeCount: listWorkspaceRuntimeIds().length,
            },
          })
        }
      }
      return { ok: true }
    },
    [
      currentWorkspaceId,
      evictWorkspaceRuntime,
      liveStateEnabled,
      pendingWorkspaceId,
      runtimeCapacity,
      updateRuntimeAccess,
      isDegradedMode,
      consecutiveFailures,
      // Note: emitDebugLog removed from deps - using ref instead
    ],
  )

  return {
    ensureRuntimePrepared,
    updateRuntimeAccess,
    runtimeAccessRef,
    isDegradedMode,
    resetDegradedMode,
  }
}
