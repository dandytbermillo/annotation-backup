"use strict"

import { ensurePanelKey } from "@/lib/canvas/composite-id"

export interface CenterOnNoteCanvasLike {
  centerOnPanel?: (storeKey: string) => void
}

export interface CenterOnNoteOptions {
  /**
   * Number of additional attempts after the initial call.
   */
  attempts?: number
  /**
   * Delay between retry attempts in milliseconds.
   */
  delayMs?: number
  /**
   * Optional guard to determine whether a retry should proceed.
   */
  shouldRetry?: () => boolean
  /**
   * Optional error handler when the underlying canvas throws.
   */
  onError?: (error: Error) => void
}

/**
 * Imperatively centers the workspace camera on the given note's main panel.
 * Falls back to no-op when the canvas handle or panel id is unavailable.
 */
export function centerOnNotePanel(
  canvas: CenterOnNoteCanvasLike | null | undefined,
  noteId: string,
  options?: CenterOnNoteOptions,
): boolean {
  if (!canvas || typeof canvas.centerOnPanel !== "function" || !noteId) {
    return false
  }

  const attempts = Math.max(0, options?.attempts ?? 0)
  const delayMs = Math.max(0, options?.delayMs ?? 0)
  const shouldRetry = options?.shouldRetry ?? (() => true)
  const storeKey = ensurePanelKey(noteId, "main")

  const run = (remaining: number) => {
    try {
      canvas.centerOnPanel!(storeKey)
    } catch (error) {
      if (options?.onError) {
        const normalized = error instanceof Error ? error : new Error(String(error))
        options.onError(normalized)
      }
      return
    }

    if (remaining > 0 && shouldRetry()) {
      setTimeout(() => run(remaining - 1), delayMs)
    }
  }

  run(attempts)
  return true
}
