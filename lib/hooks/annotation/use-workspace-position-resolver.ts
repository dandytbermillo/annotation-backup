"use client"

import { useCallback, useMemo } from "react"

// NOTE: debugLog removed from this file - this is a hot-path function called on every render
// and logging would cause thousands of DB writes, freezing the app

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
      // NOTE: No debug logs in this hot-path function - called on every render
      // and logging would cause thousands of DB writes, freezing the app
      const workspaceEntry = workspaceNoteMap.get(targetNoteId)
      if (workspaceEntry?.mainPosition && !isDefaultOffscreenPosition(workspaceEntry.mainPosition)) {
        return workspaceEntry.mainPosition
      }

      const pending = getPendingPosition(targetNoteId)
      if (pending && !isDefaultOffscreenPosition(pending)) {
        return pending
      }

      const cached = getCachedPosition(targetNoteId)
      if (cached && !isDefaultOffscreenPosition(cached)) {
        return cached
      }

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
