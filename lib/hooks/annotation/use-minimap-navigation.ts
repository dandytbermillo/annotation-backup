"use client"

import { useCallback } from "react"

import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"

export function useMinimapNavigation(updateCanvasTransform: (updater: (prev: CanvasViewportState) => CanvasViewportState) => void) {
  return useCallback(
    (x: number, y: number) => {
      updateCanvasTransform(prev => ({
        ...prev,
        translateX: x,
        translateY: y,
      }))
    },
    [updateCanvasTransform],
  )
}
