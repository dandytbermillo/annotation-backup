"use client"

import { useEffect, useRef } from "react"
import { debugLog } from "@/lib/utils/debug-logger"
import { markPanelPersistencePending } from "@/lib/note-workspaces/state"

type PanelEventDetail = {
  panelId?: string
  parentPanelId?: string
  parentPosition?: { x: number; y: number }
  previewPosition?: { x: number; y: number }
  noteId?: string
  coordinateSpace?: "screen" | "world"
}

type UsePanelCreationEventsOptions = {
  noteId: string
  handleCreatePanel: (
    panelId: string,
    parentPanelId?: string,
    parentPosition?: { x: number; y: number },
    noteId?: string,
    isPreview?: boolean,
    coordinateSpace?: "screen" | "world",
  ) => void
  handlePanelClose: (panelId: string) => void
}

export function usePanelCreationEvents({
  noteId,
  handleCreatePanel,
  handlePanelClose,
}: UsePanelCreationEventsOptions) {
  const createPanelRef = useRef(handleCreatePanel)
  const panelCloseRef = useRef(handlePanelClose)

  useEffect(() => {
    createPanelRef.current = handleCreatePanel
  }, [handleCreatePanel])

  useEffect(() => {
    panelCloseRef.current = handlePanelClose
  }, [handlePanelClose])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const logPanelEvent = (action: string, detail?: PanelEventDetail) => {
      void debugLog({
        component: "AnnotationCanvas",
        action,
        metadata: {
          panelId: detail?.panelId ?? null,
          noteId: detail?.noteId ?? null,
          parentPanelId: detail?.parentPanelId ?? null,
          hasParentPosition: Boolean(detail?.parentPosition || detail?.previewPosition),
          coordinateSpace: detail?.coordinateSpace ?? null,
        },
      })
    }

  const handlePanelEvent = (event: Event) => {
    const detail = (event as CustomEvent<PanelEventDetail>).detail
    if (!detail?.panelId) {
      return
    }
    const targetNoteId = detail.noteId || noteId
    // Immediately raise pending so workspace snapshots wait for this panel
    markPanelPersistencePending(targetNoteId, detail.panelId)
    logPanelEvent("panel_creation_event", detail)
    createPanelRef.current(
      detail.panelId,
      detail.parentPanelId,
      detail.parentPosition,
        detail.noteId,
        false,
        detail.coordinateSpace,
      )
    }

    const handlePreviewPanelEvent = (event: Event) => {
      const detail = (event as CustomEvent<PanelEventDetail>).detail
      if (!detail?.panelId) {
        return
      }
      logPanelEvent("panel_preview_event_dispatched", detail)
      const position = detail.previewPosition || detail.parentPosition

      console.log("[AnnotationCanvas] Creating preview panel:", {
        panelId: detail.panelId,
        position,
        isPreview: true,
      })

      createPanelRef.current(detail.panelId, detail.parentPanelId, position, detail.noteId, true)
    }

    const handleRemovePreviewPanelEvent = (event: Event) => {
      const detail = (event as CustomEvent<PanelEventDetail>).detail
      if (detail?.panelId) {
        panelCloseRef.current(detail.panelId)
      }
    }

    window.addEventListener("create-panel" as any, handlePanelEvent)
    window.addEventListener("preview-panel" as any, handlePreviewPanelEvent)
    window.addEventListener("remove-preview-panel" as any, handleRemovePreviewPanelEvent)

    return () => {
      window.removeEventListener("create-panel" as any, handlePanelEvent)
      window.removeEventListener("preview-panel" as any, handlePreviewPanelEvent)
      window.removeEventListener("remove-preview-panel" as any, handleRemovePreviewPanelEvent)
    }
  }, [noteId])
}
