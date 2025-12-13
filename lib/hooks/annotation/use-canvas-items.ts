"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { CanvasItem } from "@/types/canvas-items"
import { dedupeCanvasItems, type CanvasDedupeWarning } from "@/lib/canvas/dedupe-canvas-items"
import { debugLog, isDebugEnabled } from "@/lib/utils/debug-logger"

type UpdateOptions = { append?: boolean }

type UseCanvasItemsOptions = {
  noteId: string
  initialItems?: CanvasItem[]
  workspaceId?: string // FIX 17 DEBUG: Track workspace for cross-contamination debugging
}

type UseCanvasItemsResult = {
  canvasItems: CanvasItem[]
  setCanvasItems: React.Dispatch<React.SetStateAction<CanvasItem[]>>
  canvasItemsRef: React.MutableRefObject<CanvasItem[]>
  dedupeWarnings: CanvasDedupeWarning[]
  updateDedupeWarnings: (incoming: CanvasDedupeWarning[], options?: UpdateOptions) => void
}

export function useCanvasItems({ noteId, initialItems = [], workspaceId }: UseCanvasItemsOptions): UseCanvasItemsResult {
  // FIX 17 DEBUG: Log initial state on mount
  const mountedRef = useRef(false)
  if (!mountedRef.current) {
    mountedRef.current = true
    const initialComponents = initialItems.filter(item => item.itemType === "component")
    if (isDebugEnabled()) {
      debugLog({
        component: "CanvasItems",
        action: "hook_mount_initial_state",
        metadata: {
          noteId,
          workspaceId: workspaceId ?? "unknown",
          initialItemCount: initialItems.length,
          initialComponentCount: initialComponents.length,
          initialComponentTypes: initialComponents.map(c => (c as any).componentType),
        },
      })
    }
  }

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
      const debugEnabled = isDebugEnabled()
      const caller = (() => {
        if (!debugEnabled) return "unknown"
        const stack = new Error().stack
        return stack?.split("\n").slice(2, 4).join(" | ") || "unknown"
      })()

      return internalSetCanvasItems(prev => {
        const next = typeof update === "function" ? update(prev) : update

        if (next === prev) {
          if (debugEnabled) {
            debugLog({
              component: "AnnotationCanvas",
              action: "setCanvasItems_SKIPPED_SAME_REF",
              metadata: {
                noteId,
                workspaceId: workspaceId ?? "unknown",
                reason: "update_returned_same_array_reference",
                caller: caller.substring(0, 200),
              },
            })
          }
          return prev
        }

        // FIX 17 DEBUG: Detailed component tracking
        const prevComponents = prev.filter(item => item.itemType === "component")
        const nextComponents = next.filter(item => item.itemType === "component")
        const prevComponentIds = new Set(prevComponents.map(c => c.id))
        const nextComponentIds = new Set(nextComponents.map(c => c.id))

        const addedComponents = nextComponents.filter(c => !prevComponentIds.has(c.id))
        const removedComponents = prevComponents.filter(c => !nextComponentIds.has(c.id))

        // Log if components are being added - this is key for tracking contamination
        if (addedComponents.length > 0 && debugEnabled) {
          debugLog({
            component: "CanvasItems",
            action: "COMPONENT_ADDED_TO_CANVAS",
            metadata: {
              noteId,
              workspaceId: workspaceId ?? "unknown",
              addedCount: addedComponents.length,
              addedComponentIds: addedComponents.map(c => c.id),
              addedComponentTypes: addedComponents.map(c => (c as any).componentType),
              prevComponentCount: prevComponents.length,
              nextComponentCount: nextComponents.length,
              caller: caller.substring(0, 200),
            },
          })
        }

        if (removedComponents.length > 0 && debugEnabled) {
          debugLog({
            component: "CanvasItems",
            action: "COMPONENT_REMOVED_FROM_CANVAS",
            metadata: {
              noteId,
              workspaceId: workspaceId ?? "unknown",
              removedCount: removedComponents.length,
              removedComponentIds: removedComponents.map(c => c.id),
              caller: caller.substring(0, 200),
            },
          })
        }

        const mainPanels = next.filter(item => item.itemType === "panel" && item.panelId === "main")

        if (debugEnabled) {
          debugLog({
            component: "AnnotationCanvas",
            action: "setCanvasItems_called",
            metadata: {
              noteId,
              workspaceId: workspaceId ?? "unknown",
              isFunction: typeof update === "function",
              prevItemCount: prev.length,
              nextItemCount: next.length,
              prevComponentCount: prevComponents.length,
              nextComponentCount: nextComponents.length,
              mainPanelPositions: mainPanels.map(p => ({
                noteId: p.noteId,
                position: p.position,
              })),
              caller: caller.substring(0, 300),
            },
          })
        }

        const result = dedupeCanvasItems(next, { fallbackNoteId: noteId })

        if (result.removedCount > 0 && debugEnabled) {
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

        if (result.warnings.length > 0 && debugEnabled) {
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
    [noteId, workspaceId, updateDedupeWarnings, internalSetCanvasItems],
  )

  return {
    canvasItems,
    setCanvasItems,
    canvasItemsRef,
    dedupeWarnings,
    updateDedupeWarnings,
  }
}
