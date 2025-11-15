"use client"

import { useCallback } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"

import { debugLog } from "@/lib/utils/debug-logger"
import type { WorkspaceVersionUpdate } from "@/lib/workspace/persist-workspace"
import type { OpenWorkspaceNote, WorkspacePosition } from "@/lib/workspace/types"

interface WorkspacePersistPayload {
  noteId: string
  isOpen: boolean
  mainPosition?: WorkspacePosition | null
}

interface UseWorkspaceMainPositionUpdaterOptions {
  setOpenNotes: Dispatch<SetStateAction<OpenWorkspaceNote[]>>
  positionCacheRef: MutableRefObject<Map<string, WorkspacePosition>>
  syncPositionCacheToStorage: () => void
  persistWorkspace: (updates: WorkspacePersistPayload[]) => Promise<WorkspaceVersionUpdate[]>
  applyVersionUpdates: (updates: WorkspaceVersionUpdate[]) => void
  clearScheduledPersist: (noteId: string) => void
  scheduleWorkspacePersist: (noteId: string, position: WorkspacePosition) => void
}

export function useWorkspaceMainPositionUpdater({
  setOpenNotes,
  positionCacheRef,
  syncPositionCacheToStorage,
  persistWorkspace,
  applyVersionUpdates,
  clearScheduledPersist,
  scheduleWorkspacePersist,
}: UseWorkspaceMainPositionUpdaterOptions) {
  const updateMainPosition = useCallback(
    async (noteId: string, position: WorkspacePosition, persist = true) => {
      await debugLog({
        component: "CanvasWorkspace",
        action: "update_main_position_called",
        metadata: { noteId, position, persist },
      })

      positionCacheRef.current.set(noteId, position)
      syncPositionCacheToStorage()

      setOpenNotes(prev =>
        prev.map(note =>
          note.noteId === noteId
            ? {
                ...note,
                mainPosition: position,
              }
            : note,
        ),
      )

      if (persist) {
        try {
          const versionUpdates = await persistWorkspace([{ noteId, isOpen: true, mainPosition: position }])
          applyVersionUpdates(versionUpdates)
          clearScheduledPersist(noteId)
          await debugLog({
            component: "CanvasWorkspace",
            action: "update_main_position_persist_succeeded",
            metadata: { noteId },
          })
        } catch (error) {
          await debugLog({
            component: "CanvasWorkspace",
            action: "update_main_position_persist_failed",
            metadata: {
              noteId,
              error: error instanceof Error ? error.message : String(error),
            },
          })
          scheduleWorkspacePersist(noteId, position)
        }
      }
    },
    [
      applyVersionUpdates,
      clearScheduledPersist,
      persistWorkspace,
      positionCacheRef,
      scheduleWorkspacePersist,
      setOpenNotes,
      syncPositionCacheToStorage,
    ],
  )

  return { updateMainPosition }
}
