"use client"

import { useCallback, useMemo } from "react"

import { debugLog } from "@/lib/utils/debug-logger"

export interface WorkspacePositionEntry {
  mainPosition?: { x: number; y: number } | null
}

interface UseWorkspacePositionResolverOptions<T extends WorkspacePositionEntry> {
  noteId: string
  workspaceNoteMap: Map<string, T>
  getPendingPosition: (noteId: string) => { x: number; y: number } | null
  getCachedPosition: (noteId: string) => { x: number; y: number } | null
  isDefaultOffscreenPosition: (position: { x: number; y: number } | null | undefined) => boolean
}

export function useWorkspacePositionResolver<T extends WorkspacePositionEntry>({
  noteId,
  workspaceNoteMap,
  getPendingPosition,
  getCachedPosition,
  isDefaultOffscreenPosition,
}: UseWorkspacePositionResolverOptions<T>) {
  const resolveWorkspacePosition = useCallback(
    (targetNoteId: string): { x: number; y: number } | null => {
      const workspaceEntry = workspaceNoteMap.get(targetNoteId)
      if (workspaceEntry?.mainPosition && !isDefaultOffscreenPosition(workspaceEntry.mainPosition)) {
        debugLog({
          component: "AnnotationCanvas",
          action: "resolve_workspace_position_from_entry",
          metadata: {
            targetNoteId,
            position: workspaceEntry.mainPosition,
            source: "workspaceEntry.mainPosition",
          },
        })
        return workspaceEntry.mainPosition
      }

      const pending = getPendingPosition(targetNoteId)
      if (pending && !isDefaultOffscreenPosition(pending)) {
        debugLog({
          component: "AnnotationCanvas",
          action: "resolve_workspace_position_from_pending",
          metadata: {
            targetNoteId,
            position: pending,
            source: "pendingPosition",
          },
        })
        return pending
      }

      const cached = getCachedPosition(targetNoteId)
      if (cached && !isDefaultOffscreenPosition(cached)) {
        debugLog({
          component: "AnnotationCanvas",
          action: "resolve_workspace_position_from_cache",
          metadata: {
            targetNoteId,
            position: cached,
            source: "cachedPosition",
          },
        })
        return cached
      }

      debugLog({
        component: "AnnotationCanvas",
        action: "resolve_workspace_position_null",
        metadata: {
          targetNoteId,
          source: "none_found",
        },
      })

      return null
    },
    [workspaceNoteMap, getPendingPosition, getCachedPosition, isDefaultOffscreenPosition],
  )

  const workspaceMainPosition = useMemo(
    () => resolveWorkspacePosition(noteId),
    [noteId, resolveWorkspacePosition],
  )

  return {
    resolveWorkspacePosition,
    workspaceMainPosition,
  }
}
