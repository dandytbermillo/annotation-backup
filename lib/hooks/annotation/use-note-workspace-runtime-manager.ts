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
  captureSnapshot: (workspaceId?: string | null) => Promise<void>
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
      emitDebugLog?.({
        component: "NoteWorkspaceRuntime",
        action: "workspace_runtime_eviction_start",
        metadata: {
          workspaceId,
          reason,
          runtimeCount: listWorkspaceRuntimeIds().length,
        },
      })
      await captureSnapshot(workspaceId)
      await persistSnapshot(workspaceId, reason)
      removeWorkspaceRuntime(workspaceId)
      runtimeAccessRef.current.delete(workspaceId)
      emitDebugLog?.({
        component: "NoteWorkspaceRuntime",
        action: "workspace_runtime_evicted",
        metadata: {
          workspaceId,
          reason,
          runtimeCount: listWorkspaceRuntimeIds().length,
        },
      })
      return true
    },
    [captureSnapshot, currentWorkspaceId, emitDebugLog, liveStateEnabled, persistSnapshot],
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
          emitDebugLog?.({
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
      emitDebugLog,
      evictWorkspaceRuntime,
      liveStateEnabled,
      pendingWorkspaceId,
      runtimeCapacity,
      updateRuntimeAccess,
    ],
  )

  return {
    ensureRuntimePrepared,
    updateRuntimeAccess,
    runtimeAccessRef,
  }
}
