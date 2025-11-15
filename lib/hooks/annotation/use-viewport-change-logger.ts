"use client"

import { useEffect, useRef } from "react"

import { debugLog } from "@/lib/utils/debug-logger"
import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"

interface UseViewportChangeLoggerOptions {
  noteId: string
  canvasState: CanvasViewportState
}

export function useViewportChangeLogger({ noteId, canvasState }: UseViewportChangeLoggerOptions) {
  const previousViewportRef = useRef({
    x: canvasState.translateX,
    y: canvasState.translateY,
  })

  useEffect(() => {
    const prev = previousViewportRef.current
    const changed = prev.x !== canvasState.translateX || prev.y !== canvasState.translateY

    if (!changed) {
      return
    }

    const stack = new Error().stack
    const caller = stack?.split("\n")[3] || "unknown"

    debugLog({
      component: "AnnotationCanvas",
      action: "viewport_changed",
      metadata: {
        noteId,
        from: { x: prev.x, y: prev.y },
        to: { x: canvasState.translateX, y: canvasState.translateY },
        delta: {
          x: canvasState.translateX - prev.x,
          y: canvasState.translateY - prev.y,
        },
        zoom: canvasState.zoom,
        caller: caller.trim(),
        isDragging: canvasState.isDragging,
      },
    })

    previousViewportRef.current = { x: canvasState.translateX, y: canvasState.translateY }
  }, [canvasState.translateX, canvasState.translateY, canvasState.isDragging, canvasState.zoom, noteId])
}
