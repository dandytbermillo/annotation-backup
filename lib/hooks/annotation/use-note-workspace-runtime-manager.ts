import { useCallback, useRef } from "react"

import {
  getWorkspaceRuntime,
  hasWorkspaceRuntime,
  listWorkspaceRuntimeIds,
  removeWorkspaceRuntime,
} from "@/lib/workspace/runtime-manager"

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
}

export type NoteWorkspaceRuntimeManagerResult = {
  ensureRuntimePrepared: (workspaceId: string | null | undefined, reason: string) => Promise<void>
  updateRuntimeAccess: (workspaceId: string | null | undefined) => void
  runtimeAccessRef: React.MutableRefObject<Map<string, number>>
}

export function useNoteWorkspaceRuntimeManager({
  liveStateEnabled,
  currentWorkspaceId,
  pendingWorkspaceId,
  runtimeCapacity,
  captureSnapshot,
  persistSnapshot,
  emitDebugLog,
}: RuntimeManagerOptions): NoteWorkspaceRuntimeManagerResult {
  const runtimeAccessRef = useRef<Map<string, number>>(new Map())

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
    async (workspaceId: string | null | undefined, reason: string) => {
      if (!liveStateEnabled || !workspaceId) return false
      if (!hasWorkspaceRuntime(workspaceId)) return false
      if (workspaceId === currentWorkspaceId) return false

      // Capture the workspaceId in a const to ensure it doesn't change during async operations
      const targetWorkspaceId = workspaceId

      // Get LATEST functions via refs (avoiding stale closures)
      const logFn = emitDebugLogRef.current
      const captureFn = captureSnapshotRef.current

      logFn?.({
        component: "NoteWorkspaceRuntime",
        action: "workspace_runtime_eviction_start",
        metadata: {
          workspaceId: targetWorkspaceId,
          reason,
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
        },
      })

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
          runtimeCount: listWorkspaceRuntimeIds().length,
        },
      })
      return true
    },
    // Note: We intentionally DO NOT include captureSnapshot, persistSnapshot, or emitDebugLog
    // in the dependency array. The function uses refs to access the latest versions, so it
    // doesn't need to be recreated when these functions change. This prevents the stale
    // closure issue that was causing eviction to fail to persist.
    [currentWorkspaceId, liveStateEnabled],
  )

  const ensureRuntimePrepared = useCallback(
    async (workspaceId: string | null | undefined, reason: string) => {
      if (!liveStateEnabled || !workspaceId) return
      updateRuntimeAccess(workspaceId)
      if (!hasWorkspaceRuntime(workspaceId)) {
        const runtimeIds = listWorkspaceRuntimeIds()
        if (runtimeIds.length >= runtimeCapacity) {
          const excludeIds = new Set<string>([workspaceId])
          if (currentWorkspaceId) excludeIds.add(currentWorkspaceId)
          if (pendingWorkspaceId) excludeIds.add(pendingWorkspaceId)
          let candidate: string | null = null
          let oldest = Number.POSITIVE_INFINITY
          runtimeIds.forEach((id) => {
            if (excludeIds.has(id)) return
            const ts = runtimeAccessRef.current.get(id) ?? 0
            if (ts < oldest) {
              oldest = ts
              candidate = id
            }
          })
          if (candidate) {
            await evictWorkspaceRuntime(candidate, "capacity")
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
    },
    [
      currentWorkspaceId,
      evictWorkspaceRuntime,
      liveStateEnabled,
      pendingWorkspaceId,
      runtimeCapacity,
      updateRuntimeAccess,
      // Note: emitDebugLog removed from deps - using ref instead
    ],
  )

  return {
    ensureRuntimePrepared,
    updateRuntimeAccess,
    runtimeAccessRef,
  }
}
