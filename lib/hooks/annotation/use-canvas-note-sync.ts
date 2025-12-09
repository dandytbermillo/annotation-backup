"use client"

import { useEffect, useCallback, useRef } from "react"

import { createPanelItem } from "@/types/canvas-items"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { getDefaultMainPosition } from "@/lib/canvas/canvas-defaults"
// NOTE: debugLog removed - this hook runs on every render cycle and was causing
// thousands of DB writes per minute, freezing the app
import type { DataStore } from "@/lib/data-store"

import type { CanvasItem } from "@/types/canvas-items"

export function getStoredPanelPosition(
  dataStore: DataStore | null,
  branchesMap: Map<string, any> | null,
  targetNoteId: string | null | undefined,
  panelId: string | null | undefined,
) {
  if (!targetNoteId || !panelId) {
    return null
  }

  const storeKey = ensurePanelKey(targetNoteId, panelId)
  const stored = dataStore?.get(storeKey) ?? branchesMap?.get(storeKey)
  if (!stored) {
    return null
  }

  const worldPosition = stored.worldPosition ?? stored.position
  if (
    worldPosition &&
    typeof worldPosition.x === "number" &&
    typeof worldPosition.y === "number" &&
    Number.isFinite(worldPosition.x) &&
    Number.isFinite(worldPosition.y)
  ) {
    return { x: worldPosition.x, y: worldPosition.y }
  }

  return null
}

type UseCanvasNoteSyncOptions = {
  hasNotes: boolean
  noteIds: string[]
  noteId: string
  mainOnlyNoteSet: Set<string>
  freshNoteSeeds: Record<string, { x: number; y: number }>
  onConsumeFreshNoteSeed?: (noteId: string) => void
  setCanvasItems: React.Dispatch<React.SetStateAction<CanvasItem[]>>
  getItemNoteId: (item: CanvasItem) => string | null
  resolveWorkspacePosition: (noteId: string) => { x: number; y: number } | null
  dataStore: DataStore | null
  branchesMap: Map<string, any> | null
  hydrationStateKey: number | string | boolean
  workspaceSnapshotRevision?: number
  hydrationInProgressRef?: React.MutableRefObject<boolean>
  workspaceRestorationInProgressRef?: React.MutableRefObject<boolean>
}

export function useCanvasNoteSync({
  hasNotes,
  noteIds,
  noteId,
  mainOnlyNoteSet,
  freshNoteSeeds,
  onConsumeFreshNoteSeed,
  setCanvasItems,
  getItemNoteId,
  resolveWorkspacePosition,
  dataStore,
  branchesMap,
  hydrationStateKey,
  workspaceSnapshotRevision = 0,
  hydrationInProgressRef,
  workspaceRestorationInProgressRef,
}: UseCanvasNoteSyncOptions) {
  const lastSnapshotRevisionRef = useRef(workspaceSnapshotRevision)
  const resolveStoredPanelPosition = useCallback(
    (targetNoteId: string | null | undefined, panelId: string | null | undefined) =>
      getStoredPanelPosition(dataStore, branchesMap, targetNoteId, panelId),
    [dataStore, branchesMap],
  )
  useEffect(() => {
    const revisionChanged = lastSnapshotRevisionRef.current !== workspaceSnapshotRevision
    lastSnapshotRevisionRef.current = workspaceSnapshotRevision

    if (!hasNotes) {
      // FIX 16: Use functional update to prevent render loop.
      setCanvasItems(prev => {
        if (prev.length === 0) {
          return prev
        }
        return []
      })
      return
    }

    setCanvasItems(prev => {
      // Skip during workspace restoration
      if (workspaceRestorationInProgressRef?.current) {
        return prev
      }

      // Skip during snapshot restoration
      if (revisionChanged) {
        return prev
      }

      // Skip during hydration
      if (hydrationInProgressRef?.current) {
        return prev
      }

      const allowedNoteIds = new Set(noteIds)
      let changed = false

      const mainByNote = new Map<string, CanvasItem>()
      const otherItems: CanvasItem[] = []

      prev.forEach(item => {
        if (item.itemType === "panel" && item.panelId === "main") {
          const itemNoteId = getItemNoteId(item)
          if (itemNoteId && allowedNoteIds.has(itemNoteId)) {
            mainByNote.set(itemNoteId, item)
          } else {
            changed = true
          }
          return
        }

        const itemNoteId = getItemNoteId(item)
        if (
          item.itemType === "panel" &&
          item.panelId !== "main" &&
          itemNoteId &&
          mainOnlyNoteSet.has(itemNoteId)
        ) {
          changed = true
          return
        }
        if (itemNoteId && !allowedNoteIds.has(itemNoteId)) {
          changed = true
          return
        }

        if (item.itemType === "panel" && item.panelId && itemNoteId) {
          const storedPosition = resolveStoredPanelPosition(itemNoteId, item.panelId)
          if (storedPosition) {
            const samePosition =
              item.position?.x === storedPosition.x && item.position?.y === storedPosition.y
            otherItems.push(
              samePosition
                ? item
                : {
                    ...item,
                    position: storedPosition,
                  },
            )
            if (!samePosition) {
              changed = true
            }
            return
          }
        }

        otherItems.push(item)
      })

      const nextMainItems: CanvasItem[] = []
      noteIds.forEach(id => {
        const existing = mainByNote.get(id)
        const targetStoreKey = ensurePanelKey(id, "main")

        if (existing) {
          const storedPosition = resolveStoredPanelPosition(id, "main")
          const nextPosition = storedPosition ?? existing.position
          const needsMetaUpdate =
            existing.noteId !== id ||
            existing.storeKey !== targetStoreKey ||
            (storedPosition !== null &&
              (existing.position?.x !== nextPosition?.x || existing.position?.y !== nextPosition?.y))

          if (needsMetaUpdate) {
            nextMainItems.push({
              ...existing,
              position: nextPosition,
              noteId: id,
              storeKey: targetStoreKey,
            })
            changed = true
          } else {
            nextMainItems.push(existing)
          }
        } else {
          const seedPosition = freshNoteSeeds[id] ?? null
          const storedPosition = resolveStoredPanelPosition(id, "main")
          const targetPosition =
            seedPosition ??
            resolveWorkspacePosition(id) ??
            storedPosition ??
            getDefaultMainPosition()

          nextMainItems.push(
            createPanelItem("main", targetPosition, "main", id, targetStoreKey),
          )

          // FIX: Seed DataStore immediately when creating new panel.
          // Without this, PanelsRenderer calls dataStore.get(storeKey) and gets null,
          // causing the panel to not render even though it's in canvasItems.
          // Previously, useDefaultMainPanelPersistence was supposed to do this,
          // but it depends on hydrationStatus.success which never fires for
          // dynamically added notes (hydration gets interrupted).
          if (dataStore && !dataStore.get(targetStoreKey)) {
            dataStore.set(targetStoreKey, {
              id: "main",
              type: "main" as const,
              title: "",
              position: targetPosition,
              worldPosition: targetPosition,
              dimensions: { width: 420, height: 350 },
              originalText: "",
              isEditable: true,
              branches: [],
              parentId: null,
              content: undefined,
              preview: "",
              hasHydratedContent: false,
              state: "active",
              closedAt: null,
            })
          }

          if (seedPosition && onConsumeFreshNoteSeed) {
            queueMicrotask(() => onConsumeFreshNoteSeed(id))
          }
          changed = true
        }
      })

      const newItems = [...nextMainItems, ...otherItems]

      if (!changed && newItems.length === prev.length) {
        return prev
      }

      return newItems
    })
  }, [
    hasNotes,
    noteIds,
    noteId,
    // canvasItemsLength removed from dependencies - only used for debug logging
    // Keeping it as a dependency caused re-triggers when items were cleared during workspace switches
    mainOnlyNoteSet,
    freshNoteSeeds,
    onConsumeFreshNoteSeed,
    setCanvasItems,
    getItemNoteId,
    resolveWorkspacePosition,
    resolveStoredPanelPosition,
    hydrationStateKey,
    workspaceSnapshotRevision,
  ])
}
