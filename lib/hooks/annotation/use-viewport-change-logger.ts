"use client"

import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"

interface UseViewportChangeLoggerOptions {
  noteId: string
  canvasState: CanvasViewportState
}

/**
 * DISABLED: This hook was logging viewport changes to the database on every pan/zoom,
 * causing 300+ DB writes per minute and freezing the app.
 * The hook is now a no-op. Remove usage or re-enable with console.log for debugging only.
 */
export function useViewportChangeLogger(_options: UseViewportChangeLoggerOptions) {
  // No-op - hot-path logging disabled for performance
}
