import { useCallback, useEffect, useRef, useState } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"

import type { LayerContextValue } from "@/components/canvas/layer-provider"
import { useCanvas } from "@/components/canvas/canvas-context"
import { debugLog } from "@/lib/utils/debug-logger"
import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import { createDefaultCanvasState } from "@/lib/canvas/canvas-defaults"

type ViewportState = CanvasViewportState

type UseCanvasTransformOptions = {
  noteId: string
  layerContext: LayerContextValue | null
  onCanvasStateChange?: (state: {
    zoom: number
    showConnections: boolean
    translateX: number
    translateY: number
    lastInteraction?: { x: number; y: number } | null
  }) => void
  initialStateFactory?: () => ViewportState
}

type UseCanvasTransformResult = {
  canvasState: ViewportState
  updateCanvasTransform: (
    updater: (prev: ViewportState) => ViewportState,
  ) => void
  panBy: (deltaX: number, deltaY: number) => void
  setCanvasState: Dispatch<SetStateAction<ViewportState>>
  canvasStateRef: MutableRefObject<ViewportState>
  lastCanvasEventRef: MutableRefObject<{ x: number; y: number } | null>
}

export function useCanvasTransform({
  noteId,
  layerContext,
  onCanvasStateChange,
  initialStateFactory,
}: UseCanvasTransformOptions): UseCanvasTransformResult {
  const [canvasState, _setCanvasState] = useState<ViewportState>(() => {
    try {
      if (initialStateFactory) {
        const next = initialStateFactory()
        if (next) {
          return next
        }
      }
    } catch (error) {
      debugLog({
        component: "AnnotationCanvas",
        action: "initial_state_factory_failed",
        metadata: { noteId, error: error instanceof Error ? error.message : String(error) },
      })
    }
    return createDefaultCanvasState()
  })
  const canvasStateRef = useRef(canvasState)
  const lastCanvasEventRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    canvasStateRef.current = canvasState
  }, [canvasState])

  useEffect(() => {
    if (typeof window !== "undefined") {
      const fallbackPoint = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      lastCanvasEventRef.current = fallbackPoint
      ;(window as any).__canvasLastInteraction = fallbackPoint
    }
  }, [])

  useEffect(() => {
    onCanvasStateChange?.({
      zoom: canvasState.zoom,
      showConnections: canvasState.showConnections,
      translateX: canvasState.translateX,
      translateY: canvasState.translateY,
      lastInteraction: lastCanvasEventRef.current,
    })
  }, [
    canvasState.zoom,
    canvasState.showConnections,
    canvasState.translateX,
    canvasState.translateY,
    onCanvasStateChange,
  ])

  const setCanvasState: typeof _setCanvasState = useCallback((update) => {
    const stack = new Error().stack
    const caller = stack?.split("\n").slice(2, 6).join(" | ") || "unknown"

    debugLog({
      component: "AnnotationCanvas",
      action: "setCanvasState_called",
      metadata: {
        noteId,
        isFunction: typeof update === "function",
        caller: caller.substring(0, 500),
      },
    })

    return _setCanvasState(update)
  }, [noteId])

  const scheduleDispatch = useCanvasContextScheduler({ noteId, layerContext, canvasStateRef })

  const updateCanvasTransform = useCallback(
    (updater: (prev: ViewportState) => ViewportState) => {
      setCanvasState(prev => {
        const next = updater(prev)
        if (
          next.translateX !== prev.translateX ||
          next.translateY !== prev.translateY ||
          next.zoom !== prev.zoom
        ) {
          scheduleDispatch({
            translateX: next.translateX,
            translateY: next.translateY,
            zoom: next.zoom,
          })
        }
        return next
      })
    },
    [scheduleDispatch, setCanvasState],
  )

  const panBy = useCallback(
    (deltaX: number, deltaY: number) => {
      if (deltaX === 0 && deltaY === 0) {
        return
      }
      updateCanvasTransform(prev => ({
        ...prev,
        translateX: prev.translateX + deltaX,
        translateY: prev.translateY + deltaY,
      }))
    },
    [updateCanvasTransform],
  )

  return {
    canvasState,
    updateCanvasTransform,
    panBy,
    setCanvasState,
    canvasStateRef,
    lastCanvasEventRef,
  }
}

type SchedulerOptions = {
  noteId: string
  layerContext: LayerContextValue | null
  canvasStateRef: MutableRefObject<ViewportState>
}

type DispatchPayload = { translateX: number; translateY: number; zoom: number }

function useCanvasContextScheduler(_opts: SchedulerOptions) {
  const { state: canvasContextState, dispatch } = useCanvas()
  const pendingDispatchRef = useRef<DispatchPayload>({
    translateX: canvasContextState.canvasState.translateX,
    translateY: canvasContextState.canvasState.translateY,
    zoom: canvasContextState.canvasState.zoom,
  })
  const dispatchFrameRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (dispatchFrameRef.current != null) {
        cancelAnimationFrame(dispatchFrameRef.current)
        dispatchFrameRef.current = null
      }
    }
  }, [])

  return useCallback((next: DispatchPayload) => {
    pendingDispatchRef.current = next
    if (dispatchFrameRef.current != null) {
      return
    }

    dispatchFrameRef.current = requestAnimationFrame(() => {
      dispatchFrameRef.current = null
      const payload = pendingDispatchRef.current
      const current = canvasContextState.canvasState
      if (
        payload.translateX === current.translateX &&
        payload.translateY === current.translateY &&
        payload.zoom === current.zoom
      ) {
        return
      }

      dispatch({
        type: "SET_CANVAS_STATE",
        payload,
      })
    })
  }, [canvasContextState.canvasState, dispatch])
}
