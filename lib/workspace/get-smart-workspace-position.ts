"use client"

import { DEFAULT_PANEL_DIMENSIONS } from "@/lib/canvas/panel-metrics"
import type { WorkspacePosition } from "@/lib/workspace/types"

export function getSmartWorkspacePosition(): WorkspacePosition {
  const fallbackCenter = (() => {
    const { width, height } = DEFAULT_PANEL_DIMENSIONS
    if (typeof window === "undefined") {
      return { x: 0, y: 0 }
    }
    return {
      x: Math.round(window.innerWidth / 2 - width / 2),
      y: Math.round(window.innerHeight / 2 - height / 2),
    }
  })()

  if (typeof window === "undefined") {
    return fallbackCenter
  }

  const allPanels = document.querySelectorAll("[data-store-key]")
  if (allPanels.length === 0) {
    return fallbackCenter
  }

  let rightmostX = 0
  let rightmostY = fallbackCenter.y
  let rightmostWidth = DEFAULT_PANEL_DIMENSIONS.width

  allPanels.forEach(panel => {
    const style = window.getComputedStyle(panel as HTMLElement)
    const rect = (panel as HTMLElement).getBoundingClientRect()
    const panelX = parseFloat(style.left) || 0
    const panelY = parseFloat(style.top) || fallbackCenter.y
    const panelWidth = rect.width || DEFAULT_PANEL_DIMENSIONS.width

    if (panelX + panelWidth > rightmostX + rightmostWidth) {
      rightmostX = panelX
      rightmostY = panelY
      rightmostWidth = panelWidth
    }
  })

  const gap = 50
  return {
    x: Math.round(rightmostX + rightmostWidth + gap),
    y: Math.round(rightmostY),
  }
}
