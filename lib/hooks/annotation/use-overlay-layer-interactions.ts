import { useCallback } from "react"
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
  canvasState,
  debugLog,
  setNotesWidgetPosition,
  setShowNotesWidget,
  showNotesWidget,
  setActivePanelId,
}: UseOverlayLayerInteractionsOptions): UseOverlayLayerInteractionsResult {
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
