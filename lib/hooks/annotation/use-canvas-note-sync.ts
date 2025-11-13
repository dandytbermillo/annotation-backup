"use client"

import { useEffect } from "react"

import { createPanelItem } from "@/types/canvas-items"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { getDefaultMainPosition, isDefaultMainPosition } from "@/lib/canvas/canvas-defaults"
import { debugLog } from "@/lib/utils/debug-logger"

import type { CanvasItem } from "@/types/canvas-items"

type UseCanvasNoteSyncOptions = {
  hasNotes: boolean
  noteIds: string[]
  noteId: string
  canvasItemsLength: number
  mainOnlyNoteSet: Set<string>
  freshNoteSeeds: Record<string, { x: number; y: number }>
  onConsumeFreshNoteSeed?: (noteId: string) => void
  setCanvasItems: React.Dispatch<React.SetStateAction<CanvasItem[]>>
  getItemNoteId: (item: CanvasItem) => string | null
  resolveWorkspacePosition: (noteId: string) => { x: number; y: number } | null
}

export function useCanvasNoteSync({
  hasNotes,
  noteIds,
  noteId,
  canvasItemsLength,
  mainOnlyNoteSet,
  freshNoteSeeds,
  onConsumeFreshNoteSeed,
  setCanvasItems,
  getItemNoteId,
  resolveWorkspacePosition,
}: UseCanvasNoteSyncOptions) {
  useEffect(() => {
    debugLog({
      component: "AnnotationCanvas",
      action: "noteIds_sync_effect_triggered",
      metadata: {
        hasNotes,
        noteIds,
        currentItemsCount: canvasItemsLength,
        currentNoteIdProp: noteId,
      },
    })

    if (!hasNotes) {
      setCanvasItems([])
      return
    }

    setCanvasItems(prev => {
      const allowedNoteIds = new Set(noteIds)
      let changed = false

      const mainByNote = new Map<string, CanvasItem>()
      const otherItems: CanvasItem[] = []

      const prevMainPanels = prev
        .filter(item => item.itemType === "panel" && item.panelId === "main")
        .map(item => ({
          noteId: getItemNoteId(item),
          position: item.position,
        }))

      prev.forEach(item => {
        if (item.itemType === "panel" && item.panelId === "main") {
          const itemNoteId = getItemNoteId(item)
          if (itemNoteId && allowedNoteIds.has(itemNoteId)) {
            mainByNote.set(itemNoteId, item)
          } else {
            changed = true
          }
          return
        }

        const itemNoteId = getItemNoteId(item)
        if (
          item.itemType === "panel" &&
          item.panelId !== "main" &&
          itemNoteId &&
          mainOnlyNoteSet.has(itemNoteId)
        ) {
          changed = true
          return
        }
        if (itemNoteId && !allowedNoteIds.has(itemNoteId)) {
          changed = true
          return
        }

        otherItems.push(item)
      })

      const nextMainItems: CanvasItem[] = []
      noteIds.forEach(id => {
        const existing = mainByNote.get(id)
        const targetStoreKey = ensurePanelKey(id, "main")

        if (existing) {
          const needsMetaUpdate = existing.noteId !== id || existing.storeKey !== targetStoreKey

          if (needsMetaUpdate) {
            debugLog({
              component: "AnnotationCanvas",
              action: "noteIds_sync_updating_metadata_only",
              metadata: {
                noteId: id,
                existingNoteId: existing.noteId,
                existingPosition: existing.position,
                keepingPosition: true,
              },
            })

            nextMainItems.push({
              ...existing,
              position: existing.position,
              noteId: id,
              storeKey: targetStoreKey,
            })
            changed = true
          } else {
            nextMainItems.push(existing)
          }
        } else {
          const seedPosition = freshNoteSeeds[id] ?? null
          const targetPosition =
            seedPosition ??
            resolveWorkspacePosition(id) ??
            getDefaultMainPosition()

          debugLog({
            component: "AnnotationCanvas",
            action: "noteIds_sync_creating_new_panel",
            metadata: {
              noteId: id,
              targetPosition,
              source: seedPosition
                ? "fresh_seed"
                : isDefaultMainPosition(targetPosition)
                  ? "default"
                  : "workspace",
            },
          })

          nextMainItems.push(
            createPanelItem("main", targetPosition, "main", id, targetStoreKey),
          )
          if (seedPosition && onConsumeFreshNoteSeed) {
            queueMicrotask(() => onConsumeFreshNoteSeed(id))
          }
          changed = true
        }
      })

      const newItems = [...nextMainItems, ...otherItems]

      if (!changed && newItems.length === prev.length) {
        debugLog({
          component: "AnnotationCanvas",
          action: "noteIds_sync_NO_CHANGE",
          metadata: {
            noteIds,
            itemCount: prev.length,
            reason: "items_unchanged_returning_prev",
          },
        })
        return prev
      }

      const nextMainPanels = nextMainItems.map(item => ({
        noteId: getItemNoteId(item),
        position: item.position,
      }))

      debugLog({
        component: "AnnotationCanvas",
        action: "noteIds_sync_updated_items",
        metadata: {
          prevCount: prev.length,
          newCount: newItems.length,
          changed,
          noteIdsInput: noteIds,
          currentNoteIdProp: noteId,
          prevMainPanels,
          nextMainPanels,
          mainByNoteKeys: Array.from(mainByNote.keys()),
        },
      })

      return newItems
    })
  }, [
    hasNotes,
    noteIds,
    noteId,
    canvasItemsLength,
    mainOnlyNoteSet,
    freshNoteSeeds,
    onConsumeFreshNoteSeed,
    setCanvasItems,
    getItemNoteId,
    resolveWorkspacePosition,
  ])
}
