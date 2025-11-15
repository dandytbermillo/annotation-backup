"use client"

import { useCallback } from "react"
import type { Dispatch, SetStateAction } from "react"

import { ensurePanelKey } from "@/lib/canvas/composite-id"
import type { DataStore } from "@/lib/data-store"
import type { PanelUpdateData } from "@/lib/hooks/use-panel-persistence"
import { debugLog } from "@/lib/utils/debug-logger"
import type { CanvasItem } from "@/types/canvas-items"

interface UseMainPanelRestoreOptions {
  setCanvasItems: Dispatch<SetStateAction<CanvasItem[]>>
  getItemNoteId: (item: CanvasItem) => string | null
  dataStore: DataStore | null
  persistPanelUpdate: (update: PanelUpdateData) => Promise<void>
  updateMainPosition: (noteId: string, position: { x: number; y: number }) => Promise<void>
  onMainOnlyLayoutHandled?: (noteId: string) => void
  centerOnPanel: (storeKey: string) => void
}

export function useMainPanelRestore({
  setCanvasItems,
  getItemNoteId,
  dataStore,
  persistPanelUpdate,
  updateMainPosition,
  onMainOnlyLayoutHandled,
  centerOnPanel,
}: UseMainPanelRestoreOptions) {
  const handleRestoreMainPosition = useCallback(
    (targetNoteId: string, persistedPosition: { x: number; y: number }) => {
      const storeKey = ensurePanelKey(targetNoteId, "main")
      const normalizedPosition = { x: persistedPosition.x, y: persistedPosition.y }

      setCanvasItems(prev =>
        prev.map(item => {
          if (item.itemType === "panel" && item.panelId === "main") {
            const itemNoteId = getItemNoteId(item)
            if (itemNoteId === targetNoteId) {
              return { ...item, position: normalizedPosition }
            }
          }
          return item
        }),
      )

      if (dataStore) {
        try {
          dataStore.update(storeKey, { position: normalizedPosition })
        } catch (error) {
          console.warn("[AnnotationCanvas] Failed to update dataStore for restore", error)
        }
      }

      persistPanelUpdate({
        panelId: "main",
        storeKey,
        position: normalizedPosition,
        coordinateSpace: "world",
      }).catch(error => {
        console.warn("[AnnotationCanvas] Failed to persist panel during restore", error)
      })

      void updateMainPosition(targetNoteId, normalizedPosition).catch(error => {
        console.error("[AnnotationCanvas] Failed to update workspace main position during restore", error)
      })

      debugLog({
        component: "AnnotationCanvas",
        action: "restore_main_position",
        metadata: { noteId: targetNoteId, position: normalizedPosition },
      })

      onMainOnlyLayoutHandled?.(targetNoteId)
      centerOnPanel(storeKey)
    },
    [
      centerOnPanel,
      dataStore,
      getItemNoteId,
      onMainOnlyLayoutHandled,
      persistPanelUpdate,
      setCanvasItems,
      updateMainPosition,
    ],
  )

  return { handleRestoreMainPosition }
}
