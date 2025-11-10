import { useCallback, useState } from "react"
import type { CanvasSidebarTab } from "@/components/sidebar/canvas-sidebar"
import type { LayerContextValue } from "@/components/canvas/layer-provider"
import { useCanvasMode, type CanvasMode } from "@/lib/canvas/use-canvas-mode"

type UseConstellationViewStateOptions = {
  layerContext: LayerContextValue | null
  defaultTab?: CanvasSidebarTab
}

export function useConstellationViewState({
  layerContext,
  defaultTab = "organization",
}: UseConstellationViewStateOptions) {
  const [activeSidebarTab, setActiveSidebarTab] = useState<CanvasSidebarTab>(defaultTab)

  const { mode: canvasMode, setMode: setCanvasMode } = useCanvasMode({
    layerContext,
    onModeChange: useCallback(
      (nextMode: CanvasMode) => {
        if (nextMode === "constellation") {
          setActiveSidebarTab("constellation")
        } else if (activeSidebarTab === "constellation") {
          setActiveSidebarTab("organization")
        }
      },
      [activeSidebarTab],
    ),
  })

  const showConstellationPanel = canvasMode === "constellation"

  const handleSidebarTabChange = useCallback(
    (tab: CanvasSidebarTab) => {
      setActiveSidebarTab(tab)
      setCanvasMode(tab === "constellation" ? "constellation" : "overlay")
    },
    [setCanvasMode],
  )

  const toggleConstellationView = useCallback(() => {
    setCanvasMode(showConstellationPanel ? "overlay" : "constellation")
  }, [setCanvasMode, showConstellationPanel])

  return {
    activeSidebarTab,
    showConstellationPanel,
    canvasMode,
    setCanvasMode,
    handleSidebarTabChange,
    toggleConstellationView,
  }
}
