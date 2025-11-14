"use client"

import { useEffect, useRef } from "react"

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

    const handlePanelEvent = (event: Event) => {
      const detail = (event as CustomEvent<PanelEventDetail>).detail
      if (!detail?.panelId) {
        return
      }

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
