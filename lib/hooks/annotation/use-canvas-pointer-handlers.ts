"use client"

import { useCallback, useEffect, useState } from "react"
import type { MutableRefObject, SetStateAction, Dispatch } from "react"
import type React from "react"

import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import { getWheelZoomMultiplier } from "@/lib/canvas/zoom-utils"

export type CanvasToolType = 'select' | 'pan'

type UseCanvasPointerHandlersOptions = {
  captureInteractionPoint: (event: { clientX: number; clientY: number }, source?: "canvas" | "keyboard" | "toolbar") => void
  setCanvasState: Dispatch<SetStateAction<CanvasViewportState>>
  canvasStateRef: MutableRefObject<CanvasViewportState>
  updateCanvasTransform: (updater: (prev: CanvasViewportState) => CanvasViewportState) => void
  enableSelectionGuards: () => void
  disableSelectionGuards: () => void
  canvasState: CanvasViewportState
  /** Current canvas tool - 'select' or 'pan'. When 'select', panning requires holding Space. */
  canvasTool?: CanvasToolType
}

export function useCanvasPointerHandlers({
  captureInteractionPoint,
  setCanvasState,
  canvasStateRef,
  updateCanvasTransform,
  enableSelectionGuards,
  disableSelectionGuards,
  canvasState,
  canvasTool = 'select',
}: UseCanvasPointerHandlersOptions) {
  // Track if space key is held for temporary pan mode
  const [isSpaceHeld, setIsSpaceHeld] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        // Don't trigger if user is typing in an input
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return
        }
        setIsSpaceHeld(true)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceHeld(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  // Determine if panning should be allowed
  const canPan = canvasTool === 'pan' || isSpaceHeld

  const handleCanvasMouseDown = useCallback(
    (event: React.MouseEvent) => {
      captureInteractionPoint(event)
      if (event.button !== 0) return

      const target = event.target instanceof Element ? event.target : null
      if (target && (target.closest(".panel") || target.closest("[data-component-panel]"))) return

      // Only start panning if tool is 'pan' or space is held
      if (!canPan) return

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
    [captureInteractionPoint, enableSelectionGuards, setCanvasState, canPan],
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
    /** Whether space key is currently held (enables temporary pan mode) */
    isSpaceHeld,
    /** Whether panning is currently allowed (pan tool active or space held) */
    canPan,
  }
}
