"use client"

import { useEffect, useRef } from "react"
import type { Dispatch, SetStateAction } from "react"
import type { LayerContextValue } from "@/components/canvas/layer-provider"

type UseOverlayLayerHotkeysOptions = {
  layerContext: LayerContextValue | null
  multiLayerEnabled: boolean
  clearAllTimeouts: () => void
  setNotesWidgetPosition: Dispatch<SetStateAction<{ x: number; y: number }>>
  setShowNotesWidget: Dispatch<SetStateAction<boolean>>
  showNotesWidget: boolean
}

export function useOverlayLayerHotkeys({
  layerContext,
  multiLayerEnabled,
  clearAllTimeouts,
  setNotesWidgetPosition,
  setShowNotesWidget,
  showNotesWidget,
}: UseOverlayLayerHotkeysOptions) {
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

  const mousePositionRef = useRef<{ x: number; y: number }>({
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 0,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 0,
  })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY }
    }

    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
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
}
