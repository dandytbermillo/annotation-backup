import { useCallback, useEffect, useRef, useState } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"

import type { LayerContextValue } from "@/components/canvas/layer-provider"
import { useCanvas } from "@/components/canvas/canvas-context"
import { debugLog } from "@/lib/utils/debug-logger"
import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import { createDefaultCanvasState } from "@/lib/canvas/canvas-defaults"
import {
  captureOrigin,
  clampTranslateX,
  hasOrigin,
} from "@/lib/canvas/directional-scroll-origin"
import {
  isWorkspaceLifecycleReady,
  subscribeToLifecycleChanges,
} from "@/lib/workspace/durability/lifecycle-manager"

type ViewportState = CanvasViewportState

type UseCanvasTransformOptions = {
  noteId: string
  /** Workspace ID for directional scroll origin tracking */
  workspaceId?: string | null
  layerContext: LayerContextValue | null
  onCanvasStateChange?: (state: {
    zoom: number
    showConnections: boolean
    translateX: number
    translateY: number
    lastInteraction?: { x: number; y: number } | null
  }) => void
  initialStateFactory?: () => ViewportState
  /** When true, skip directional scroll clamping (for programmatic camera changes) */
  bypassDirectionalClamp?: boolean
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
  workspaceId,
  layerContext,
  onCanvasStateChange,
  initialStateFactory,
  bypassDirectionalClamp = false,
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

  // Directional Scroll: Capture origin when workspace lifecycle becomes ready
  // This sets the baseline translateX that the user cannot pan left beyond
  // We subscribe to lifecycle changes to capture at the exact moment of 'ready' transition
  const originCapturedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return

    // Helper to attempt origin capture with double-capture guard
    const attemptCapture = (currentWorkspaceId: string): boolean => {
      // Guard: check both ref and storage to prevent double capture
      if (originCapturedRef.current === currentWorkspaceId || hasOrigin(currentWorkspaceId)) {
        return false
      }
      // Use ref to get current translate values (not stale closure value)
      const currentTranslateX = canvasStateRef.current.translateX
      const currentTranslateY = canvasStateRef.current.translateY
      const captured = captureOrigin(currentWorkspaceId, currentTranslateX, currentTranslateY)
      if (captured) {
        originCapturedRef.current = currentWorkspaceId
        debugLog({
          component: "DirectionalScroll",
          action: "origin_captured_on_ready",
          metadata: {
            workspaceId: currentWorkspaceId,
            originTranslateX: currentTranslateX,
            originTranslateY: currentTranslateY,
          },
        })
      }
      return captured
    }

    // If already ready, capture immediately
    if (isWorkspaceLifecycleReady(workspaceId)) {
      attemptCapture(workspaceId)
      return // No need to subscribe if already ready
    }

    // Subscribe to lifecycle changes to capture when 'ready' transition occurs
    const unsubscribe = subscribeToLifecycleChanges((changedWorkspaceId, lifecycle) => {
      // Only react to 'ready' transitions for our workspace
      if (changedWorkspaceId === workspaceId && lifecycle === 'ready') {
        attemptCapture(workspaceId)
      }
    })

    // Cleanup subscription on unmount or workspace change
    return () => {
      unsubscribe()
      // Clear ref on workspace change (storage cleared by eviction logic)
      originCapturedRef.current = null
    }
  }, [workspaceId])

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
        let next = updater(prev)

        // Directional Scroll: Apply horizontal clamp if enabled
        if (!bypassDirectionalClamp && workspaceId) {
          const clampedX = clampTranslateX(workspaceId, next.translateX)
          if (clampedX !== next.translateX) {
            next = { ...next, translateX: clampedX }
          }
        }

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
    [scheduleDispatch, setCanvasState, bypassDirectionalClamp, workspaceId],
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
