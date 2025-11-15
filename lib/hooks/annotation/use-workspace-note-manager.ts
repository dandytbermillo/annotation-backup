"use client"

import { useCallback } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"

import type { WorkspaceVersionUpdate } from "@/lib/workspace/persist-workspace"
import type { NoteWorkspace, OpenWorkspaceNote, WorkspacePosition } from "@/lib/workspace/types"
import { getSmartWorkspacePosition } from "@/lib/workspace/get-smart-workspace-position"

interface WorkspaceNotePayload {
  noteId: string
  isOpen: boolean
  mainPosition?: WorkspacePosition | null
}

interface UseWorkspaceNoteManagerOptions {
  setOpenNotes: Dispatch<SetStateAction<OpenWorkspaceNote[]>>
  ensureWorkspaceForOpenNotes: (notes: OpenWorkspaceNote[]) => void
  workspaceVersionsRef: MutableRefObject<Map<string, number>>
  positionCacheRef: MutableRefObject<Map<string, WorkspacePosition>>
  pendingPersistsRef: MutableRefObject<Map<string, WorkspacePosition>>
  persistWorkspace: (updates: WorkspaceNotePayload[]) => Promise<WorkspaceVersionUpdate[]>
  scheduleWorkspacePersist: (noteId: string, position: WorkspacePosition) => void
  clearScheduledPersist: (noteId: string) => void
  applyVersionUpdates: (updates: WorkspaceVersionUpdate[]) => void
  syncPositionCacheToStorage: () => void
  workspacesRef: MutableRefObject<Map<string, NoteWorkspace>>
  invalidateLocalSnapshot: (noteId: string) => void
  fetchImpl?: typeof fetch
}

export function useWorkspaceNoteManager({
  setOpenNotes,
  ensureWorkspaceForOpenNotes,
  workspaceVersionsRef,
  positionCacheRef,
  pendingPersistsRef,
  persistWorkspace,
  scheduleWorkspacePersist,
  clearScheduledPersist,
  applyVersionUpdates,
  syncPositionCacheToStorage,
  workspacesRef,
  invalidateLocalSnapshot,
  fetchImpl,
}: UseWorkspaceNoteManagerOptions) {
  const openNote = useCallback(
    async (noteId: string, options?: { mainPosition?: WorkspacePosition | null; persist?: boolean; persistPosition?: boolean }) => {
      const { mainPosition = null, persist = true, persistPosition = true } = options ?? {}
      const pendingPosition = pendingPersistsRef.current.get(noteId) ?? null
      const cachedPosition = positionCacheRef.current.get(noteId) ?? null

      const smartDefaultPosition = mainPosition ?? pendingPosition ?? cachedPosition ?? getSmartWorkspacePosition()
      const normalizedPosition = smartDefaultPosition

      if (normalizedPosition) {
        positionCacheRef.current.set(noteId, normalizedPosition)
        syncPositionCacheToStorage()
      }
      const positionToPersist = persistPosition ? normalizedPosition : null

      console.log(`[DEBUG openNote] Position resolution for ${noteId}:`, {
        mainPosition,
        pendingPosition,
        cachedPosition,
        smartDefaultPosition,
        normalizedPosition,
      })
      if (!noteId) {
        return
      }

      let alreadyOpen = false

      setOpenNotes(prev => {
        const exists = prev.some(note => note.noteId === noteId)
        alreadyOpen = exists
        if (exists) {
          return prev.map(note =>
            note.noteId === noteId
              ? {
                  ...note,
                  mainPosition: mainPosition ?? note.mainPosition ?? normalizedPosition,
                }
              : note,
          )
        }
        const version = workspaceVersionsRef.current.get(noteId) ?? 0
        const next: OpenWorkspaceNote = {
          noteId,
          mainPosition: normalizedPosition,
          updatedAt: null,
          version,
        }

        return [...prev, next]
      })

      ensureWorkspaceForOpenNotes([
        {
          noteId,
          mainPosition: normalizedPosition,
          updatedAt: null,
          version: workspaceVersionsRef.current.get(noteId) ?? 0,
        },
      ])

      const shouldPersist = persist && (!alreadyOpen || !!positionToPersist)

      if (shouldPersist) {
        const payload: WorkspaceNotePayload = {
          noteId,
          isOpen: true,
        }
        if (positionToPersist) {
          payload.mainPosition = positionToPersist
        }
        try {
          const versionUpdates = await persistWorkspace([payload])
          applyVersionUpdates(versionUpdates)
          clearScheduledPersist(noteId)
        } catch (error) {
          console.warn("[CanvasWorkspace] Immediate workspace persist failed, scheduling retry", {
            noteId,
            error: error instanceof Error ? error.message : String(error),
          })
          if (positionToPersist) {
            pendingPersistsRef.current.set(noteId, positionToPersist)
            scheduleWorkspacePersist(noteId, positionToPersist)
          }
        }
      }
    },
    [
      setOpenNotes,
      workspaceVersionsRef,
      ensureWorkspaceForOpenNotes,
      persistWorkspace,
      applyVersionUpdates,
      clearScheduledPersist,
      pendingPersistsRef,
      positionCacheRef,
      scheduleWorkspacePersist,
      syncPositionCacheToStorage,
    ],
  )

  const closeNote = useCallback(
    async (noteId: string, options?: { persist?: boolean; removeWorkspace?: boolean }) => {
      if (!noteId) {
        return
      }

      const { persist = true, removeWorkspace: remove = true } = options ?? {}

      setOpenNotes(prev => prev.filter(note => note.noteId !== noteId))

      if (remove) {
        workspacesRef.current.delete(noteId)
      }

      if (persist) {
        const versionUpdates = await persistWorkspace([{ noteId, isOpen: false }])
        applyVersionUpdates(versionUpdates)
        invalidateLocalSnapshot(noteId)
        try {
          await (fetchImpl ?? fetch)(`/api/canvas/layout/${noteId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              updates: [
                {
                  id: "main",
                  state: "closed",
                },
              ],
            }),
          })
        } catch (error) {
          console.warn("[CanvasWorkspace] Failed to mark main panel closed", {
            noteId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    },
    [persistWorkspace, applyVersionUpdates, invalidateLocalSnapshot, workspacesRef, setOpenNotes, fetchImpl],
  )

  return { openNote, closeNote }
}
