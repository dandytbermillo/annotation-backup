"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { CanvasItem } from "@/types/canvas-items"
import { dedupeCanvasItems, type CanvasDedupeWarning } from "@/lib/canvas/dedupe-canvas-items"
import { debugLog } from "@/lib/utils/debug-logger"

type UpdateOptions = { append?: boolean }

type UseCanvasItemsOptions = {
  noteId: string
  initialItems?: CanvasItem[]
}

type UseCanvasItemsResult = {
  canvasItems: CanvasItem[]
  setCanvasItems: React.Dispatch<React.SetStateAction<CanvasItem[]>>
  canvasItemsRef: React.MutableRefObject<CanvasItem[]>
  dedupeWarnings: CanvasDedupeWarning[]
  updateDedupeWarnings: (incoming: CanvasDedupeWarning[], options?: UpdateOptions) => void
}

export function useCanvasItems({ noteId, initialItems = [] }: UseCanvasItemsOptions): UseCanvasItemsResult {
  const [canvasItems, internalSetCanvasItems] = useState<CanvasItem[]>(initialItems)
  const canvasItemsRef = useRef<CanvasItem[]>(canvasItems)

  useEffect(() => {
    canvasItemsRef.current = canvasItems
  }, [canvasItems])

  const [dedupeWarnings, setDedupeWarnings] = useState<CanvasDedupeWarning[]>([])

  const updateDedupeWarnings = useCallback(
    (incoming: CanvasDedupeWarning[], options: UpdateOptions = {}) => {
      setDedupeWarnings(prev => {
        const combined = options.append ? [...prev, ...incoming] : [...incoming]
        if (combined.length === 0) {
          return prev.length === 0 ? prev : []
        }

        const serialize = (warning: CanvasDedupeWarning) =>
          `${warning.code}:${warning.panelId ?? ""}:${warning.noteId ?? ""}:${warning.storeKey ?? ""}:${warning.message}`

        const uniqueMap = new Map<string, CanvasDedupeWarning>()
        combined.forEach(warning => {
          uniqueMap.set(serialize(warning), warning)
        })

        const normalized = Array.from(uniqueMap.values())
        normalized.sort((a, b) => serialize(a).localeCompare(serialize(b)))

        const prevSerialized = prev.map(serialize)
        const normalizedSerialized = normalized.map(serialize)
        const isSame =
          prevSerialized.length === normalizedSerialized.length &&
          prevSerialized.every((value, index) => value === normalizedSerialized[index])

        if (isSame) {
          return prev
        }

        return normalized
      })
    },
    [],
  )

  const setCanvasItems: typeof internalSetCanvasItems = useCallback(
    (update) => {
      const stack = new Error().stack
      const caller = stack?.split("\n").slice(2, 4).join(" | ") || "unknown"

      return internalSetCanvasItems(prev => {
        const next = typeof update === "function" ? update(prev) : update

        if (next === prev) {
          debugLog({
            component: "AnnotationCanvas",
            action: "setCanvasItems_SKIPPED_SAME_REF",
            metadata: {
              noteId,
              reason: "update_returned_same_array_reference",
              caller: caller.substring(0, 200),
            },
          })
          return prev
        }

        const mainPanels = next.filter(item => item.itemType === "panel" && item.panelId === "main")

        debugLog({
          component: "AnnotationCanvas",
          action: "setCanvasItems_called",
          metadata: {
            noteId,
            isFunction: typeof update === "function",
            prevItemCount: prev.length,
            nextItemCount: next.length,
            mainPanelPositions: mainPanels.map(p => ({
              noteId: p.noteId,
              position: p.position,
            })),
            caller: caller.substring(0, 300),
          },
        })

        const result = dedupeCanvasItems(next, { fallbackNoteId: noteId })

        if (result.removedCount > 0) {
          debugLog({
            component: "AnnotationCanvas",
            action: "canvasItems_deduped_at_source",
            metadata: {
              noteId,
              removedCount: result.removedCount,
              resultingCount: result.items.length,
            },
          })
        }

        if (result.warnings.length > 0) {
          result.warnings.forEach(warning => {
            debugLog({
              component: "AnnotationCanvas",
              action: "canvasItems_dedupe_warning",
              metadata: {
                code: warning.code,
                panelId: warning.panelId ?? null,
                noteId: warning.noteId ?? null,
                storeKey: warning.storeKey ?? null,
              },
              content_preview: warning.message,
            })
          })
        }

        if (result.warnings.length > 0) {
          queueMicrotask(() => updateDedupeWarnings(result.warnings, { append: false }))
        } else {
          queueMicrotask(() => updateDedupeWarnings([], { append: false }))
        }

        return result.items
      })
    },
    [noteId, updateDedupeWarnings, internalSetCanvasItems],
  )

  return {
    canvasItems,
    setCanvasItems,
    canvasItemsRef,
    dedupeWarnings,
    updateDedupeWarnings,
  }
}
