"use client"

import { useEffect, useCallback, useRef } from "react"

import { createPanelItem } from "@/types/canvas-items"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { getDefaultMainPosition, isDefaultMainPosition } from "@/lib/canvas/canvas-defaults"
import { debugLog } from "@/lib/utils/debug-logger"
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
  canvasItemsLength: number
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
  canvasItemsLength,
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
    debugLog({
      component: "AnnotationCanvas",
      action: "noteIds_sync_effect_triggered",
      metadata: {
        hasNotes,
        noteIds,
        currentItemsCount: canvasItemsLength,
        currentNoteIdProp: noteId,
        revisionChanged,
        workspaceSnapshotRevision,
      },
    })

    if (!hasNotes) {
      // FIX 16: Use functional update to prevent render loop.
      // Previously, setCanvasItems([]) created a NEW empty array every time,
      // causing React to detect a state change ([] !== []) and re-render,
      // which re-triggered this effect in an infinite loop.
      // Now we check if already empty and return prev to prevent the loop.
      setCanvasItems(prev => {
        if (prev.length === 0) {
          // Already empty - return same reference to prevent re-render
          return prev
        }
        debugLog({
          component: "AnnotationCanvas",
          action: "clearing_canvas_items_no_notes",
          metadata: {
            reason: "hasNotes_is_false",
            previousCount: prev.length,
          },
        })
        return []
      })
      return
    }

    setCanvasItems(prev => {
      debugLog({
        component: "AnnotationCanvas",
        action: "setCanvasItems_called_before_sync",
        metadata: {
          prevItemsCount: prev.length,
          prevPanelIds: prev.filter(item => item.itemType === "panel").map(p => p.panelId),
          noteIds,
          revisionChanged,
          workspaceRestorationInProgress: workspaceRestorationInProgressRef?.current ?? false,
        },
      })

      // COMPREHENSIVE FIX: Skip ALL syncs during workspace restoration
      // This prevents syncs triggered by ANY dependency change (noteIds, noteId, etc.)
      // from running before snapshot restore + hydration complete
      if (workspaceRestorationInProgressRef?.current) {
        debugLog({
          component: "AnnotationCanvas",
          action: "noteIds_sync_skip_during_workspace_restoration",
          metadata: {
            reason: "workspace_restoration_in_progress",
            workspaceSnapshotRevision,
            prevItemsCount: prev.length,
            prevPanelIds: prev.filter(item => item.itemType === "panel").map(p => p.panelId),
          },
        })
        return prev
      }

      // Option 3: Skip filtering entirely when workspace snapshot revision changed
      // Let workspace snapshot restoration control canvas items during workspace switches
      if (revisionChanged) {
        debugLog({
          component: "AnnotationCanvas",
          action: "noteIds_sync_skip_during_snapshot_restoration",
          metadata: {
            reason: "let_workspace_snapshot_control_items",
            workspaceSnapshotRevision,
            prevItemsCount: prev.length,
            prevPanelIds: prev.filter(item => item.itemType === "panel").map(p => p.panelId),
          },
        })
        return prev
      }

      // Skip filtering while non-main panel hydration is in progress
      // This prevents the race condition where hydration fetches panels asynchronously
      // but sync runs again and filters them out before hydration completes
      if (hydrationInProgressRef?.current) {
        debugLog({
          component: "AnnotationCanvas",
          action: "noteIds_sync_skip_during_hydration",
          metadata: {
            reason: "non_main_panel_hydration_in_progress",
            prevItemsCount: prev.length,
            prevPanelIds: prev.filter(item => item.itemType === "panel").map(p => p.panelId),
          },
        })
        return prev
      }

      const allowedNoteIds = new Set(noteIds)
      let changed = false

      const mainByNote = new Map<string, CanvasItem>()
      const otherItems: CanvasItem[] = []

      const prevMainPanels = prev
        .filter(item => item.itemType === "panel" && item.panelId === "main")
        .map(item => ({
          noteId: getItemNoteId(item),
          position: item.position,
        }))

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
            debugLog({
              component: "AnnotationCanvas",
              action: "noteIds_sync_updating_metadata_only",
              metadata: {
                noteId: id,
                existingNoteId: existing.noteId,
                existingPosition: existing.position,
                keepingPosition: storedPosition === null,
              },
            })

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

          debugLog({
            component: "AnnotationCanvas",
            action: "noteIds_sync_creating_new_panel",
            metadata: {
              noteId: id,
              targetPosition,
              source: seedPosition
                ? "fresh_seed"
                : isDefaultMainPosition(targetPosition)
                  ? "default"
                  : "workspace",
            },
          })

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
            debugLog({
              component: "AnnotationCanvas",
              action: "noteIds_sync_seeded_datastore",
              metadata: {
                noteId: id,
                storeKey: targetStoreKey,
                position: targetPosition,
              },
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
        debugLog({
          component: "AnnotationCanvas",
          action: "noteIds_sync_NO_CHANGE",
          metadata: {
            noteIds,
            itemCount: prev.length,
            reason: "items_unchanged_returning_prev",
          },
        })
        return prev
      }

      const nextMainPanels = nextMainItems.map(item => ({
        noteId: getItemNoteId(item),
        position: item.position,
      }))

      debugLog({
        component: "AnnotationCanvas",
        action: "noteIds_sync_updated_items",
        metadata: {
          prevCount: prev.length,
          newCount: newItems.length,
          changed,
          noteIdsInput: noteIds,
          currentNoteIdProp: noteId,
          prevMainPanels,
          nextMainPanels,
          mainByNoteKeys: Array.from(mainByNote.keys()),
          prevPanelIds: prev.filter(item => item.itemType === "panel").map(p => p.panelId),
          newPanelIds: newItems.filter(item => item.itemType === "panel").map(p => p.panelId),
        },
      })

      if (changed) {
        debugLog({
          component: "AnnotationCanvas",
          action: "canvas_items_state_will_change",
          metadata: {
            previousPanelIds: prev.filter(item => item.itemType === "panel").map(p => p.panelId),
            newPanelIds: newItems.filter(item => item.itemType === "panel").map(p => p.panelId),
            panelsRemoved: prev.filter(item => item.itemType === "panel" && !newItems.some(ni => ni.itemType === "panel" && ni.panelId === item.panelId)).map(p => p.panelId),
            panelsAdded: newItems.filter(item => item.itemType === "panel" && !prev.some(pi => pi.itemType === "panel" && pi.panelId === item.panelId)).map(p => p.panelId),
          },
        })
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
