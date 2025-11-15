"use client"

import { useMemo } from "react"
import { createPortal } from "react-dom"

import { StickyNoteOverlayPanel } from "@/components/canvas/sticky-note-overlay-panel"
import type { CanvasItem } from "@/types/canvas-items"

interface UseStickyNoteOverlayPanelsOptions {
  stickyOverlayEl: HTMLElement | null
  stickyNoteItems: CanvasItem[]
  onClose: (id: string) => void
  onPositionChange: (id: string, position: { x: number; y: number }) => void
}

export function useStickyNoteOverlayPanels({
  stickyOverlayEl,
  stickyNoteItems,
  onClose,
  onPositionChange,
}: UseStickyNoteOverlayPanelsOptions) {
  const stickyNoteOverlayPortal = useMemo(() => {
    if (!stickyOverlayEl || stickyNoteItems.length === 0) {
      return null
    }

    return createPortal(
      stickyNoteItems.map(component => (
        <StickyNoteOverlayPanel
          key={component.id}
          id={component.id}
          position={component.position}
          onClose={onClose}
          onPositionChange={onPositionChange}
        />
      )),
      stickyOverlayEl,
    )
  }, [stickyOverlayEl, stickyNoteItems, onClose, onPositionChange])

  return { stickyNoteOverlayPortal }
}
