import { ensurePanelKey } from "@/lib/canvas/composite-id"
import type { DataStore } from "@/lib/data-store"
import type { CanvasItem } from "@/types/canvas-items"

export interface PanelDimensions {
  width: number
  height: number
}

interface ResolvePanelDimensionsOptions {
  /** Current note identifier used for composite keys */
  noteId: string
  /** Logical panel identifier (e.g. "main") */
  panelId: string
  /** Canonical data store for panel metadata */
  dataStore: DataStore
  /** Current canvas items (used as a secondary fallback) */
  canvasItems?: CanvasItem[]
  /** Optional override for document access (useful for testing) */
  doc?: Document | null
  /** Default dimensions when no measurement is available */
  defaultDimensions?: PanelDimensions
}

const DEFAULT_PANEL_DIMENSIONS: PanelDimensions = { width: 520, height: 440 }

/**
 * Resolve the latest screen-space dimensions for a panel.
 *
 * Priority order:
 * 1. Live DOM measurement (if element is mounted and has non-zero bounds)
 * 2. Data store snapshot (`dimensions` captured via persistence)
 * 3. Canvas items cache (e.g. pre-hydration defaults)
 * 4. Provided defaultDimensions (falls back to shared default)
 */
export function resolvePanelDimensions(options: ResolvePanelDimensionsOptions): PanelDimensions {
  const {
    noteId,
    panelId,
    dataStore,
    canvasItems = [],
    doc = typeof document !== "undefined" ? document : null,
    defaultDimensions = DEFAULT_PANEL_DIMENSIONS,
  } = options

  // Attempt live DOM measurement first – reflects current rendered size.
  if (doc) {
    const element = doc.querySelector<HTMLElement>(`[data-panel-id="${panelId}"]`)
    if (element) {
      const width = element.offsetWidth
      const height = element.offsetHeight
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return { width, height }
      }
    }
  }

  // Fall back to dataStore dimensions (updated by persistence pipeline).
  const storeKey = ensurePanelKey(noteId, panelId)
  const branch = dataStore.get(storeKey)
  const branchWidth = branch?.dimensions?.width
  const branchHeight = branch?.dimensions?.height
  if (
    typeof branchWidth === "number" &&
    typeof branchHeight === "number" &&
    Number.isFinite(branchWidth) &&
    Number.isFinite(branchHeight)
  ) {
    return { width: branchWidth, height: branchHeight }
  }

  // Optional fallback: canvasItems entry (e.g., hydrations before persistence).
  const item = canvasItems.find((candidate) => candidate.itemType === "panel" && candidate.panelId === panelId)
  const itemWidth = item?.dimensions?.width
  const itemHeight = item?.dimensions?.height
  if (
    typeof itemWidth === "number" &&
    typeof itemHeight === "number" &&
    Number.isFinite(itemWidth) &&
    Number.isFinite(itemHeight)
  ) {
    return { width: itemWidth, height: itemHeight }
  }

  return defaultDimensions
}

/**
 * Convenience helper primarily for tests – safely probes DOM measurements without
 * throwing inside server-side or headless environments.
 */
export function measurePanelElement(panelId: string, doc: Document | null = typeof document !== "undefined" ? document : null): PanelDimensions | null {
  if (!doc) return null
  const element = doc.querySelector<HTMLElement>(`[data-panel-id="${panelId}"]`)
  if (!element) return null
  const width = element.offsetWidth
  const height = element.offsetHeight
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width, height }
}

export { DEFAULT_PANEL_DIMENSIONS }
