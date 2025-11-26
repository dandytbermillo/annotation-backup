"use client"

import { useEffect, useRef } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"

import type { CanvasItem } from "@/types/canvas-items"
import { debugLog } from "@/lib/utils/debug-logger"

type WorkspacePosition = { x: number; y: number }

type UseWorkspaceHydrationSeedOptions = {
  noteId: string
  workspaceMainPosition: WorkspacePosition | null
  hydrationSuccess: boolean
  canvasItems: CanvasItem[]
  setCanvasItems: Dispatch<SetStateAction<CanvasItem[]>>
  getItemNoteId: (item: CanvasItem) => string | null
  workspaceSeededNotesRef: MutableRefObject<Set<string>>
  workspaceSnapshotRevision?: number
}

export function useWorkspaceHydrationSeed({
  noteId,
  workspaceMainPosition,
  hydrationSuccess,
  canvasItems,
  setCanvasItems,
  getItemNoteId,
  workspaceSeededNotesRef,
  workspaceSnapshotRevision = 0,
}: UseWorkspaceHydrationSeedOptions) {
  const lastSnapshotRevisionRef = useRef(workspaceSnapshotRevision)
  useEffect(() => {
    if (workspaceSnapshotRevision !== lastSnapshotRevisionRef.current) {
      lastSnapshotRevisionRef.current = workspaceSnapshotRevision
      workspaceSeededNotesRef.current.add(noteId)
      debugLog({
        component: "AnnotationCanvas",
        action: "workspace_seed_skip_due_to_snapshot_replay",
        metadata: {
          noteId,
          workspaceSnapshotRevision,
          seededNotes: Array.from(workspaceSeededNotesRef.current),
        },
      })
      return
    }

    const mainPanelExists = canvasItems.some(item => {
      if (item.itemType === "panel" && item.panelId === "main") {
        const itemNoteId = getItemNoteId(item)
        return itemNoteId === noteId
      }
      return false
    })

    const alreadySeeded = workspaceSeededNotesRef.current.has(noteId)

    debugLog({
      component: "AnnotationCanvas",
      action: "workspaceSeedAppliedRef_effect_triggered",
      metadata: {
        noteId,
        mainPanelExists,
        workspaceSeedApplied: alreadySeeded,
        hasWorkspacePosition: !!workspaceMainPosition,
        workspacePosition: workspaceMainPosition,
        hydrationSuccess,
        willUpdatePosition: !alreadySeeded && !!workspaceMainPosition && !hydrationSuccess,
        seededNotes: Array.from(workspaceSeededNotesRef.current),
      },
    })

    if (alreadySeeded) return
    if (!workspaceMainPosition) return
    if (hydrationSuccess) return

    debugLog({
      component: "AnnotationCanvas",
      action: "WORKSPACE_SEED_UPDATING_POSITIONS",
      metadata: {
        noteId,
        workspaceMainPosition,
        reason: "workspace_seed_applied_new_note",
      },
    })

    let applied = false
    setCanvasItems(prev => {
      let changed = false
      const next = prev.map(item => {
        if (item.itemType === "panel" && item.panelId === "main") {
          const itemNoteId = getItemNoteId(item)

          if (itemNoteId === noteId) {
            const samePosition =
              item.position?.x === workspaceMainPosition.x && item.position?.y === workspaceMainPosition.y

            if (samePosition) {
              applied = true
              return item
            }

            changed = true
            applied = true
            return { ...item, position: workspaceMainPosition }
          }
        }

        return item
      })

      if (changed) {
        applied = true
        return next
      }

      return prev
    })

    if (applied) {
      workspaceSeededNotesRef.current.add(noteId)
      debugLog({
        component: "AnnotationCanvas",
        action: "workspace_seed_applied_from_workspace_effect",
        metadata: {
          noteId,
          seedPosition: workspaceMainPosition,
          seededNotes: Array.from(workspaceSeededNotesRef.current),
        },
      })
    }
  }, [
    canvasItems,
    getItemNoteId,
    hydrationSuccess,
    noteId,
    setCanvasItems,
    workspaceMainPosition,
    workspaceSeededNotesRef,
    workspaceSnapshotRevision,
  ])
}
