import { useCallback, useEffect, useRef } from "react"
import type React from "react"
import type { Dispatch, SetStateAction } from "react"
import type { LayerContextValue } from "@/components/canvas/layer-provider"

type DebugLogFn = (payload: {
  component: string
  action: string
  metadata?: Record<string, unknown>
}) => void

type UseOverlayLayerInteractionsOptions = {
  layerContext: LayerContextValue | null
  multiLayerEnabled: boolean
  clearAllTimeouts: () => void
  canvasState: {
    translateX: number
    translateY: number
  }
  debugLog: DebugLogFn
  setNotesWidgetPosition: Dispatch<SetStateAction<{ x: number; y: number }>>
  setShowNotesWidget: Dispatch<SetStateAction<boolean>>
  showNotesWidget: boolean
  setActivePanelId: Dispatch<SetStateAction<string | null>>
}

type UseOverlayLayerInteractionsResult = {
  handleContextMenu: (e: React.MouseEvent) => void
}

export function useOverlayLayerInteractions({
  layerContext,
  multiLayerEnabled,
  clearAllTimeouts,
  canvasState,
  debugLog,
  setNotesWidgetPosition,
  setShowNotesWidget,
  showNotesWidget,
  setActivePanelId,
}: UseOverlayLayerInteractionsOptions): UseOverlayLayerInteractionsResult {
  const mousePositionRef = useRef<{ x: number; y: number }>({
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 0,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 0,
  })

  useEffect(() => {
    if (!multiLayerEnabled || !layerContext) return

    if (layerContext.activeLayer === "notes") {
      clearAllTimeouts()
    }
  }, [layerContext?.activeLayer, multiLayerEnabled, clearAllTimeouts, layerContext])

  useEffect(() => {
    return () => {
      clearAllTimeouts()
    }
  }, [clearAllTimeouts])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY }
    }

    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        const { x, y } = mousePositionRef.current
        setNotesWidgetPosition({ x, y })
        setShowNotesWidget(true)
      }

      if (e.key === "Escape" && showNotesWidget) {
        setShowNotesWidget(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [setNotesWidgetPosition, setShowNotesWidget, showNotesWidget])

  useEffect(() => {
    const handleShowToolbarOnSelection = (e: Event) => {
      const customEvent = e as CustomEvent
      const { x, y, autoOpenFormat } = customEvent.detail || {}

      if (typeof x === "number" && typeof y === "number") {
        setNotesWidgetPosition({ x, y })
        setShowNotesWidget(true)
      }

      if (autoOpenFormat && typeof window !== "undefined") {
        ;(window as any).__autoOpenFormatPanel = true
      }
    }

    window.addEventListener("show-floating-toolbar-on-selection", handleShowToolbarOnSelection)
    return () => window.removeEventListener("show-floating-toolbar-on-selection", handleShowToolbarOnSelection)
  }, [setNotesWidgetPosition, setShowNotesWidget])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()

      debugLog({
        component: "AnnotationApp",
        action: "context_menu_opened",
        metadata: {
          x: e.clientX,
          y: e.clientY,
          canvasTranslateX: canvasState.translateX,
          canvasTranslateY: canvasState.translateY,
        },
      })

      let target = e.target as HTMLElement
      let panelElement: HTMLElement | null = null

      while (target && target !== e.currentTarget) {
        if (target.dataset?.storeKey) {
          panelElement = target
          break
        }
        target = target.parentElement as HTMLElement
      }

      if (panelElement?.dataset?.storeKey) {
        setActivePanelId(panelElement.dataset.storeKey)
      }

      setNotesWidgetPosition({ x: e.clientX, y: e.clientY })
      setShowNotesWidget(true)

      debugLog({
        component: "AnnotationApp",
        action: "context_menu_after_open",
        metadata: {
          canvasTranslateX: canvasState.translateX,
          canvasTranslateY: canvasState.translateY,
          toolbarOpen: true,
        },
      })
    },
    [
      canvasState.translateX,
      canvasState.translateY,
      debugLog,
      setActivePanelId,
      setNotesWidgetPosition,
      setShowNotesWidget,
    ],
  )

  return { handleContextMenu }
}
