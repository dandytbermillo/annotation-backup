import { useCallback, useRef, useState } from "react"

import type { RapidSequenceState } from "@/lib/canvas/visual-centering"

export type DebugLogFn = (payload: {
  component: string
  action: string
  metadata?: Record<string, unknown>
}) => void

export type CanvasState = {
  zoom: number
  showConnections: boolean
  translateX: number
  translateY: number
}

export type InteractionSource = "canvas" | "keyboard" | "toolbar"

type CanvasStateUpdate = Partial<
  CanvasState & {
    lastInteraction?: { x: number; y: number } | null
    interactionSource?: InteractionSource
  }
>

export function useWorkspaceCanvasState() {
  const [canvasState, setCanvasState] = useState<CanvasState>({
    zoom: 1,
    showConnections: true,
    translateX: 0,
    translateY: 0,
  })

  const lastCanvasInteractionRef = useRef<{ x: number; y: number } | null>(null)
  const reopenSequenceRef = useRef<RapidSequenceState>({ count: 0, lastTimestamp: 0 })
  const newNoteSequenceRef = useRef<RapidSequenceState>({ count: 0, lastTimestamp: 0 })

  const handleCanvasStateChange = useCallback((stateUpdate: CanvasStateUpdate) => {
    let updated = false

    setCanvasState(prev => {
      const next = {
        zoom: stateUpdate.zoom ?? prev.zoom,
        showConnections: stateUpdate.showConnections ?? prev.showConnections,
        translateX: stateUpdate.translateX ?? prev.translateX,
        translateY: stateUpdate.translateY ?? prev.translateY,
      }

      if (
        next.zoom === prev.zoom &&
        next.showConnections === prev.showConnections &&
        next.translateX === prev.translateX &&
        next.translateY === prev.translateY
      ) {
        return prev
      }

      updated = true
      return next
    })

    if (stateUpdate.lastInteraction) {
      lastCanvasInteractionRef.current = stateUpdate.lastInteraction
      if (typeof window !== "undefined") {
        ;(window as any).__canvasLastInteraction = stateUpdate.lastInteraction
        ;(window as any).__canvasLastInteractionSource = stateUpdate.interactionSource ?? "canvas"
      }
      return
    }

    if (
      updated &&
      typeof window !== "undefined" &&
      (stateUpdate.translateX !== undefined || stateUpdate.translateY !== undefined)
    ) {
      const fallbackPoint = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      lastCanvasInteractionRef.current = fallbackPoint
      ;(window as any).__canvasLastInteraction = fallbackPoint
    }
  }, [])

  return {
    canvasState,
    setCanvasState,
    handleCanvasStateChange,
    lastCanvasInteractionRef,
    reopenSequenceRef,
    newNoteSequenceRef,
  }
}
