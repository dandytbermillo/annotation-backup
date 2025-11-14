"use client"

import { useCallback, type MutableRefObject } from "react"
import type React from "react"

type InteractionSource = "canvas" | "keyboard" | "toolbar"

type UseCanvasInteractionCaptureOptions = {
  lastInteractionRef: MutableRefObject<{ x: number; y: number } | null>
}

export function useCanvasInteractionCapture({ lastInteractionRef }: UseCanvasInteractionCaptureOptions) {
  const captureInteractionPoint = useCallback(
    (event: { clientX: number; clientY: number }, source: InteractionSource = "canvas") => {
      const point = { x: event.clientX, y: event.clientY }
      lastInteractionRef.current = point

      if (typeof window !== "undefined") {
        ;(window as any).__canvasLastInteraction = point
        ;(window as any).__canvasLastInteractionSource = source
      }
    },
    [lastInteractionRef],
  )

  const handleMouseMoveCapture = useCallback(
    (event: React.MouseEvent) => {
      captureInteractionPoint(event)
    },
    [captureInteractionPoint],
  )

  const handleWheelCapture = useCallback(
    (event: React.WheelEvent) => {
      captureInteractionPoint(event)
    },
    [captureInteractionPoint],
  )

  return {
    captureInteractionPoint,
    handleMouseMoveCapture,
    handleWheelCapture,
  }
}
