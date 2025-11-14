"use client"

import { useEffect } from "react"

import { saveStateToStorage, CANVAS_STORAGE_DEBOUNCE } from "@/lib/canvas/canvas-storage"
import type { CanvasItem } from "@/types/canvas-items"
import { dedupeCanvasItems } from "@/lib/canvas/dedupe-canvas-items"
import { debugLog } from "@/lib/utils/debug-logger"

type UseCanvasAutosaveOptions = {
  noteId: string
  canvasItems: CanvasItem[]
  getItemNoteId: (item: CanvasItem) => string | null
  viewportSnapshot: {
    zoom: number
    translateX: number
    translateY: number
    showConnections: boolean
  }
  isStateLoaded: boolean
  activeWorkspaceVersion: number | null
  updateDedupeWarnings: (warnings: ReturnType<typeof dedupeCanvasItems>["warnings"], options?: { append?: boolean }) => void
  autoSaveTimerRef: React.MutableRefObject<number | null>
}

export function useCanvasAutosave({
  noteId,
  canvasItems,
  getItemNoteId,
  viewportSnapshot,
  isStateLoaded,
  activeWorkspaceVersion,
  updateDedupeWarnings,
  autoSaveTimerRef,
}: UseCanvasAutosaveOptions) {
  useEffect(() => {
    if (!isStateLoaded) return

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      const thisNoteItems = canvasItems.filter(item => {
        const itemNoteId = getItemNoteId(item)
        return itemNoteId === noteId
      })

      debugLog({
        component: "AnnotationCanvas",
        action: "snapshot_save_filter",
        metadata: {
          noteId,
          totalItems: canvasItems.length,
          thisNoteItems: thisNoteItems.length,
          filteredOut: canvasItems.length - thisNoteItems.length,
        },
      })

      const dedupeResult = dedupeCanvasItems(thisNoteItems, { fallbackNoteId: noteId })

      if (dedupeResult.removedCount > 0) {
        debugLog({
          component: "AnnotationCanvas",
          action: "canvasItems_deduped_on_save",
          metadata: {
            noteId,
            removedCount: dedupeResult.removedCount,
            resultingCount: dedupeResult.items.length,
          },
        })
      }

      if (dedupeResult.warnings.length > 0) {
        dedupeResult.warnings.forEach(warning => {
          debugLog({
            component: "AnnotationCanvas",
            action: "canvasItems_dedupe_warning_on_save",
            metadata: {
              noteId,
              code: warning.code,
              panelId: warning.panelId ?? null,
              storeKey: warning.storeKey ?? null,
            },
            content_preview: warning.message,
          })
        })
        updateDedupeWarnings(dedupeResult.warnings, { append: true })
      }

      const success = saveStateToStorage(noteId, {
        viewport: viewportSnapshot,
        items: dedupeResult.items,
        workspaceVersion: activeWorkspaceVersion ?? undefined,
      })

      if (!success) {
        console.warn("[AnnotationCanvas] Failed to save canvas state")
      }

      autoSaveTimerRef.current = null
    }, CANVAS_STORAGE_DEBOUNCE)

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [
    noteId,
    viewportSnapshot,
    canvasItems,
    isStateLoaded,
    activeWorkspaceVersion,
    updateDedupeWarnings,
    getItemNoteId,
  ])
}
