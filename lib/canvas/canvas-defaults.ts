import { DEFAULT_PANEL_DIMENSIONS } from "@/lib/canvas/panel-metrics"
import { createPanelItem } from "@/types/canvas-items"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
import type { CanvasItem } from "@/types/canvas-items"

export const LEGACY_DEFAULT_MAIN_POSITION = { x: 2000, y: 1500 }

export const defaultViewport = {
  zoom: 1,
  translateX: 0,
  translateY: 0,
  showConnections: true,
}

export type CanvasViewportState = typeof defaultViewport & {
  isDragging: boolean
  lastMouseX: number
  lastMouseY: number
}

export const createDefaultCanvasState = (): CanvasViewportState => ({
  ...defaultViewport,
  isDragging: false,
  lastMouseX: 0,
  lastMouseY: 0,
})

export const getDefaultMainPosition = (): { x: number; y: number } => {
  if (typeof window === "undefined") {
    return { x: 0, y: 0 }
  }

  const { width, height } = DEFAULT_PANEL_DIMENSIONS
  const centeredX = Math.round(window.innerWidth / 2 - width / 2)
  const centeredY = Math.round(window.innerHeight / 2 - height / 2)
  return { x: centeredX, y: centeredY }
}

export const isDefaultMainPosition = (
  position: { x: number; y: number } | null | undefined,
): boolean => {
  if (!position) return false
  const defaultPosition = getDefaultMainPosition()
  const matchesCurrent =
    Math.round(position.x) === defaultPosition.x && Math.round(position.y) === defaultPosition.y
  const matchesLegacy =
    position.x === LEGACY_DEFAULT_MAIN_POSITION.x && position.y === LEGACY_DEFAULT_MAIN_POSITION.y
  return matchesCurrent || matchesLegacy
}

export const createDefaultCanvasItems = (
  noteId: string,
  mainPosition?: { x: number; y: number },
): CanvasItem[] => [
  createPanelItem(
    "main",
    mainPosition ?? getDefaultMainPosition(),
    "main",
    noteId,
    ensurePanelKey(noteId, "main"),
  ),
]

export const ensureMainPanel = (
  items: CanvasItem[],
  noteId: string,
  mainPosition?: { x: number; y: number },
): CanvasItem[] => {
  let hasMain = false

  const normalizedItems = items.map(item => {
    if (item.itemType !== "panel") {
      return item
    }

    const parsedFromStoreKey = item.storeKey ? parsePanelKey(item.storeKey) : null
    const parsedFromPanelId =
      item.panelId && item.panelId.includes("::") ? parsePanelKey(item.panelId) : null

    const resolvedNoteId =
      parsedFromStoreKey?.noteId || parsedFromPanelId?.noteId || item.noteId || noteId

    if (!hasMain && item.panelId === "main") {
      hasMain = true
    }

    return {
      ...item,
      noteId: resolvedNoteId,
      storeKey: item.storeKey ?? ensurePanelKey(resolvedNoteId, item.panelId ?? "main"),
    }
  })

  if (!hasMain) {
    normalizedItems.unshift(...createDefaultCanvasItems(noteId, mainPosition))
  }

  return normalizedItems
}
