"use client"

import { useCallback } from "react"
import type { MutableRefObject, SetStateAction, Dispatch } from "react"
import type React from "react"

import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import { getWheelZoomMultiplier } from "@/lib/canvas/zoom-utils"

type UseCanvasPointerHandlersOptions = {
  captureInteractionPoint: (event: { clientX: number; clientY: number }, source?: "canvas" | "keyboard" | "toolbar") => void
  setCanvasState: Dispatch<SetStateAction<CanvasViewportState>>
  canvasStateRef: MutableRefObject<CanvasViewportState>
  updateCanvasTransform: (updater: (prev: CanvasViewportState) => CanvasViewportState) => void
  enableSelectionGuards: () => void
  disableSelectionGuards: () => void
  canvasState: CanvasViewportState
}

export function useCanvasPointerHandlers({
  captureInteractionPoint,
  setCanvasState,
  canvasStateRef,
  updateCanvasTransform,
  enableSelectionGuards,
  disableSelectionGuards,
  canvasState,
}: UseCanvasPointerHandlersOptions) {
  const handleCanvasMouseDown = useCallback(
    (event: React.MouseEvent) => {
      captureInteractionPoint(event)
      if (event.button !== 0) return

      const target = event.target instanceof Element ? event.target : null
      if (target && (target.closest(".panel") || target.closest("[data-component-panel]"))) return

      setCanvasState(prev => ({
        ...prev,
        isDragging: true,
        lastMouseX: event.clientX,
        lastMouseY: event.clientY,
      }))

      enableSelectionGuards()
      if (typeof document !== "undefined") {
        document.body.style.userSelect = "none"
      }

      try {
        window.getSelection()?.removeAllRanges?.()
      } catch {
        // ignore failures clearing selection
      }
      event.preventDefault()
    },
    [captureInteractionPoint, enableSelectionGuards, setCanvasState],
  )

  const handleCanvasMouseMove = useCallback(
    (event: MouseEvent) => {
      captureInteractionPoint(event)
      if (!canvasStateRef.current.isDragging) return

      const deltaX = event.clientX - canvasStateRef.current.lastMouseX
      const deltaY = event.clientY - canvasStateRef.current.lastMouseY

      updateCanvasTransform(prev => ({
        ...prev,
        translateX: prev.translateX + deltaX,
        translateY: prev.translateY + deltaY,
        lastMouseX: event.clientX,
        lastMouseY: event.clientY,
      }))
    },
    [captureInteractionPoint, canvasStateRef, updateCanvasTransform],
  )

  const handleCanvasMouseUp = useCallback(() => {
    setCanvasState(prev => ({ ...prev, isDragging: false }))
    if (typeof document !== "undefined") {
      document.body.style.userSelect = ""
    }
    disableSelectionGuards()
  }, [disableSelectionGuards, setCanvasState])

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      captureInteractionPoint(event)
      if (!event.shiftKey) {
        return
      }
      event.preventDefault()

      const multiplier = getWheelZoomMultiplier(event.nativeEvent)
      const newZoom = Math.max(0.3, Math.min(2, canvasState.zoom * multiplier))

      const rect = event.currentTarget.getBoundingClientRect()
      const mouseX = event.clientX - rect.left
      const mouseY = event.clientY - rect.top
      const zoomChange = newZoom / canvasState.zoom

      updateCanvasTransform(prev => ({
        ...prev,
        zoom: newZoom,
        translateX: mouseX - (mouseX - prev.translateX) * zoomChange,
        translateY: mouseY - (mouseY - prev.translateY) * zoomChange,
      }))
    },
    [canvasState.zoom, captureInteractionPoint, updateCanvasTransform],
  )

  return {
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseUp,
    handleWheel,
  }
}
