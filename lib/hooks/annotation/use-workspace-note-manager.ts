"use client"

import { useCallback } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"

import { DEFAULT_PANEL_DIMENSIONS } from "@/lib/canvas/panel-metrics"
import type { WorkspaceVersionUpdate } from "@/lib/workspace/persist-workspace"
import type { NoteWorkspace, OpenWorkspaceNote, WorkspacePosition } from "@/lib/workspace/types"

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
  const calculateSmartDefaultPosition = useCallback((): WorkspacePosition => {
    const fallbackCenter = (() => {
      const { width, height } = DEFAULT_PANEL_DIMENSIONS
      if (typeof window === "undefined") {
        return { x: 0, y: 0 }
      }
      return {
        x: Math.round(window.innerWidth / 2 - width / 2),
        y: Math.round(window.innerHeight / 2 - height / 2),
      }
    })()

    if (typeof window === "undefined") return fallbackCenter

    const allPanels = document.querySelectorAll("[data-store-key]")
    if (allPanels.length === 0) return fallbackCenter

    let rightmostX = 0
    let rightmostY = fallbackCenter.y
    let rightmostWidth = DEFAULT_PANEL_DIMENSIONS.width

    allPanels.forEach(panel => {
      const style = window.getComputedStyle(panel as HTMLElement)
      const rect = (panel as HTMLElement).getBoundingClientRect()
      const panelX = parseFloat(style.left) || 0
      const panelY = parseFloat(style.top) || fallbackCenter.y
      const panelWidth = rect.width || DEFAULT_PANEL_DIMENSIONS.width

      if (panelX + panelWidth > rightmostX + rightmostWidth) {
        rightmostX = panelX
        rightmostY = panelY
        rightmostWidth = panelWidth
      }
    })

    const gap = 50
    return {
      x: Math.round(rightmostX + rightmostWidth + gap),
      y: Math.round(rightmostY),
    }
  }, [])

  const openNote = useCallback(
    async (noteId: string, options?: { mainPosition?: WorkspacePosition | null; persist?: boolean; persistPosition?: boolean }) => {
      const { mainPosition = null, persist = true, persistPosition = true } = options ?? {}
      const pendingPosition = pendingPersistsRef.current.get(noteId) ?? null
      const cachedPosition = positionCacheRef.current.get(noteId) ?? null

      const smartDefaultPosition = mainPosition ?? pendingPosition ?? cachedPosition ?? calculateSmartDefaultPosition()
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
      calculateSmartDefaultPosition,
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
