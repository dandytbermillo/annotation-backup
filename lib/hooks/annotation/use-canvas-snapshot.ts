"use client"

import { useEffect } from "react"
import { flushSync } from "react-dom"

import type { Dispatch, MutableRefObject, SetStateAction } from "react"

import type { CanvasItem } from "@/types/canvas-items"
import type { DataStore } from "@/lib/data-store"
import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import { createDefaultCanvasState, createDefaultCanvasItems, defaultViewport, ensureMainPanel, getDefaultMainPosition } from "@/lib/canvas/canvas-defaults"
import { loadStateFromStorage } from "@/lib/canvas/canvas-storage"
import { DEFAULT_PANEL_DIMENSIONS } from "@/lib/canvas/panel-metrics"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { dedupeCanvasItems } from "@/lib/canvas/dedupe-canvas-items"
import { panToPanel } from "@/lib/canvas/pan-animations"
import { getPlainProvider } from "@/lib/provider-switcher"
import { debugLog } from "@/lib/utils/debug-logger"

type HydrationPanel = {
  id: string
  noteId?: string
  position: { x: number; y: number }
  metadata?: Record<string, unknown>
  state?: string
}

type HydrationResult = {
  success: boolean
  panels: HydrationPanel[]
}

export type UseCanvasSnapshotOptions = {
  noteId: string
  activeWorkspaceVersion: number | null
  skipSnapshotForNote: string | null
  workspaceMainPosition: { x: number; y: number } | null
  canvasState: CanvasViewportState
  canvasStateRef: MutableRefObject<CanvasViewportState>
  canvasItems: CanvasItem[]
  getItemNoteId: (item: CanvasItem) => string | null
  isDefaultOffscreenPosition: (position: { x: number; y: number } | null | undefined) => boolean
  setCanvasState: Dispatch<SetStateAction<CanvasViewportState>>
  setCanvasItems: Dispatch<SetStateAction<CanvasItem[]>>
  setIsStateLoaded: (value: boolean) => void
  autoSaveTimerRef: MutableRefObject<number | null>
  initialCanvasSetupRef: MutableRefObject<boolean>
  skipNextContextSyncRef: MutableRefObject<boolean>
  isRestoringSnapshotRef: MutableRefObject<boolean>
  getPendingPosition: (noteId: string) => { x: number; y: number } | null
  getCachedPosition: (noteId: string) => { x: number; y: number } | null
  freshNoteSet: Set<string>
  freshNoteSeeds: Record<string, { x: number; y: number }>
  onSnapshotLoadComplete?: () => void
  onSnapshotSettled?: (noteId: string) => void
  pendingSaveMaxAgeMs: number
  dispatch: Dispatch<any>
  updateDedupeWarnings: (warnings: ReturnType<typeof dedupeCanvasItems>["warnings"], options?: { append?: boolean }) => void
  primaryHydrationStatus: HydrationResult
  dataStore: DataStore
}

export function useCanvasSnapshot({
  noteId,
  activeWorkspaceVersion,
  skipSnapshotForNote,
  workspaceMainPosition,
  canvasState,
  canvasStateRef,
  canvasItems,
  getItemNoteId,
  isDefaultOffscreenPosition,
  setCanvasState,
  setCanvasItems,
  setIsStateLoaded,
  autoSaveTimerRef,
  initialCanvasSetupRef,
  skipNextContextSyncRef,
  isRestoringSnapshotRef,
  getPendingPosition,
  getCachedPosition,
  freshNoteSet,
  freshNoteSeeds,
  onSnapshotLoadComplete,
  onSnapshotSettled,
  pendingSaveMaxAgeMs,
  dispatch,
  updateDedupeWarnings,
  primaryHydrationStatus,
  dataStore,
}: UseCanvasSnapshotOptions) {
  useEffect(() => {
    setIsStateLoaded(false)

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    const snapshot = activeWorkspaceVersion !== null
      ? loadStateFromStorage(noteId, activeWorkspaceVersion)
      : loadStateFromStorage(noteId)

    if (snapshot && skipSnapshotForNote === noteId) {
      debugLog({
        component: "AnnotationCanvas",
        action: "snapshot_restore_skipped",
        metadata: { noteId },
      })
      skipNextContextSyncRef.current = true
      initialCanvasSetupRef.current = true
      isRestoringSnapshotRef.current = false
      setIsStateLoaded(true)
      onSnapshotLoadComplete?.()
      onSnapshotSettled?.(noteId)
      return
    }

    if (!initialCanvasSetupRef.current && !snapshot) {
      setCanvasState(createDefaultCanvasState())
      setCanvasItems(createDefaultCanvasItems(noteId, workspaceMainPosition ?? undefined))
      initialCanvasSetupRef.current = true
    }

    if (!snapshot) {
      debugLog({
        component: "AnnotationCanvas",
        action: "no_saved_state_new_note",
        metadata: { noteId },
      })

      const hasSeedPosition =
        !!workspaceMainPosition && !isDefaultOffscreenPosition(workspaceMainPosition)
      const isFreshToolbarNote = freshNoteSet.has(noteId)
      const shouldSkipAutoCenter = false

      if (shouldSkipAutoCenter) {
        debugLog({
          component: "AnnotationCanvas",
          action: "new_note_auto_center_skipped",
          metadata: {
            noteId,
            reason: isFreshToolbarNote ? "fresh_note" : "seeded_position",
            seededPosition: hasSeedPosition ? workspaceMainPosition : null,
          },
        })
        setIsStateLoaded(true)
        onSnapshotLoadComplete?.()
        onSnapshotSettled?.(noteId)
        return
      }

      console.table([
        {
          Action: "No Saved State",
          NoteId: noteId,
          Time: new Date().toLocaleTimeString(),
        },
      ])

      let retries = 0
      const maxRetries = 10
      const tryCenter = () => {
        retries++

        debugLog({
          component: "AnnotationCanvas",
          action: "centering_new_note",
          metadata: { noteId, attempt: retries },
        })

        const panelEl = typeof document !== "undefined"
          ? (document.querySelector(`[data-panel-id="main"]`) as HTMLElement | null)
          : null
        if (!panelEl) {
          if (retries < maxRetries) {
            debugLog({
              component: "AnnotationCanvas",
              action: "new_note_panel_not_found_retry",
              metadata: { noteId, attempt: retries, nextRetry: "50ms" },
            })
            setTimeout(tryCenter, 50)
            return
          }

          debugLog({
            component: "AnnotationCanvas",
            action: "new_note_panel_not_found",
            metadata: { noteId, attemptsExhausted: retries },
          })
          onSnapshotLoadComplete?.()
          onSnapshotSettled?.(noteId)
          return
        }

        const panelDimensions = {
          width: panelEl.offsetWidth,
          height: panelEl.offsetHeight,
        }

        const viewportDimensions = {
          width: typeof window !== "undefined" ? window.innerWidth : 0,
          height: typeof window !== "undefined" ? window.innerHeight : 0,
        }

        const mainPanel = canvasItems.find(item => {
          if (item.itemType === "panel" && item.panelId === "main") {
            const itemNoteId = getItemNoteId(item)
            return itemNoteId === noteId
          }
          return false
        })

        const position = (() => {
          if (mainPanel?.position && !isDefaultOffscreenPosition(mainPanel.position)) {
            return mainPanel.position
          }
          if (workspaceMainPosition && !isDefaultOffscreenPosition(workspaceMainPosition)) {
            return workspaceMainPosition
          }

          const pendingPosition = getPendingPosition(noteId)
          if (pendingPosition && !isDefaultOffscreenPosition(pendingPosition)) {
            return pendingPosition
          }

          const cachedPosition = getCachedPosition(noteId)
          if (cachedPosition && !isDefaultOffscreenPosition(cachedPosition)) {
            return cachedPosition
          }

          return getDefaultMainPosition()
        })()

        debugLog({
          component: "AnnotationCanvas",
          action: "new_note_centering_source",
          metadata: {
            noteId,
            mainPanelPosition: mainPanel?.position,
            workspaceMainPosition,
            pendingPosition: getPendingPosition(noteId),
            cachedPosition: getCachedPosition(noteId),
            chosenPosition: position,
          },
        })

        const centerOffset = {
          x: (viewportDimensions.width / 2 - panelDimensions.width / 2) / canvasState.zoom,
          y: (viewportDimensions.height / 2 - panelDimensions.height / 2) / canvasState.zoom,
        }

        const targetX = -position.x + centerOffset.x
        const targetY = -position.y + centerOffset.y

        debugLog({
          component: "AnnotationCanvas",
          action: "new_note_centering_calculated",
          metadata: {
            position,
            panelDimensions,
            viewportDimensions,
            targetX,
            targetY,
          },
        })

        const canvasEl = typeof document !== "undefined"
          ? document.getElementById("infinite-canvas")
          : null
        if (canvasEl) {
          canvasEl.style.transition = "none"
          void canvasEl.offsetHeight
        }

        flushSync(() => {
          setCanvasState(prev => ({
            ...prev,
            translateX: targetX,
            translateY: targetY,
          }))
        })

        dispatch({
          type: "SET_CANVAS_STATE",
          payload: {
            translateX: targetX,
            translateY: targetY,
          },
        })

        debugLog({
          component: "AnnotationCanvas",
          action: "new_note_context_synced",
          metadata: { noteId, targetX, targetY },
        })

        if (canvasEl) {
          requestAnimationFrame(() => {
            canvasEl.style.transition = ""
          })
        }

        onSnapshotLoadComplete?.()
      }

      setTimeout(tryCenter, 0)
      setIsStateLoaded(true)
      return
    }

    const plainProvider = getPlainProvider()
    let providerVersion = 0
    let providerHasContent = false
    if (plainProvider) {
      try {
        providerVersion = plainProvider.getDocumentVersion(noteId, "main")
        const existing = plainProvider.getDocument(noteId, "main")
        providerHasContent = existing ? !plainProvider.isEmptyContent(existing) : false
      } catch (err) {
        console.warn("[AnnotationCanvas] Failed to inspect provider cache during snapshot load:", err)
      }
    }

    let pendingSnapshotBlocked = false
    if (plainProvider && typeof window !== "undefined") {
      try {
        const pendingKey = `pending_save_${noteId}_main`
        const pendingData = window.localStorage.getItem(pendingKey)
        if (pendingData) {
          const parsed = JSON.parse(pendingData) as { timestamp?: number; version?: number }
          const timestamp = typeof parsed.timestamp === "number" ? parsed.timestamp : 0
          if (timestamp) {
            const age = Date.now() - timestamp
            if (age < pendingSaveMaxAgeMs) {
              const pendingVersion = typeof parsed.version === "number" ? parsed.version : 0
              if (pendingVersion > providerVersion) {
                pendingSnapshotBlocked = true
              } else {
                window.localStorage.removeItem(pendingKey)
              }
            } else {
              window.localStorage.removeItem(pendingKey)
            }
          } else {
            window.localStorage.removeItem(pendingKey)
          }
        }
      } catch (error) {
        console.warn("[AnnotationCanvas] Failed to inspect pending backup for snapshot guard:", error)
      }
    }

    if (pendingSnapshotBlocked) {
      console.log("[AnnotationCanvas] Deferring snapshot restore; pending save has newer content", {
        noteId,
        providerVersion,
      })
      setCanvasState(prev => ({
        ...prev,
        translateX: defaultViewport.translateX,
        translateY: defaultViewport.translateY,
      }))
      setIsStateLoaded(true)
      return
    }

    console.table([
      {
        Action: "State Loaded",
        NoteId: noteId,
        Items: snapshot.items.length,
        SavedAt: new Date(snapshot.savedAt).toLocaleTimeString(),
        ProviderVersion: providerVersion,
        ProviderHasContent: providerHasContent,
      },
    ])

    const viewport = snapshot.viewport ?? defaultViewport
    const restoredTranslateX = Number.isFinite(viewport.translateX)
      ? viewport.translateX
      : defaultViewport.translateX
    const restoredTranslateY = Number.isFinite(viewport.translateY)
      ? viewport.translateY
      : defaultViewport.translateY
    const restoredZoom = Number.isFinite(viewport.zoom) ? viewport.zoom : canvasState.zoom

    if (!initialCanvasSetupRef.current) {
      initialCanvasSetupRef.current = true
    }

    isRestoringSnapshotRef.current = true

    const isNewlyOpened = freshNoteSeeds?.[noteId] !== undefined

    setCanvasState(prev => ({
      ...prev,
      zoom: restoredZoom,
      ...(isNewlyOpened
        ? {}
        : {
            translateX: restoredTranslateX,
            translateY: restoredTranslateY,
          }),
      showConnections:
        typeof viewport.showConnections === "boolean" ? viewport.showConnections : prev.showConnections,
    }))

    debugLog({
      component: "AnnotationCanvas",
      action: "snapshot_camera_restoration",
      metadata: {
        noteId,
        isNewlyOpened,
        restoredCamera: isNewlyOpened
          ? "skipped"
          : { translateX: restoredTranslateX, translateY: restoredTranslateY, zoom: restoredZoom },
        reason: isNewlyOpened ? "newly_opened_will_be_centered" : "reload_or_tab_switch",
      },
    })

    requestAnimationFrame(() => {
      isRestoringSnapshotRef.current = false
    })

    let restoredItems = ensureMainPanel(
      snapshot.items.map(item => ({ ...item })) as CanvasItem[],
      noteId,
      workspaceMainPosition ?? undefined,
    )
    const dedupeFromSnapshot = dedupeCanvasItems(restoredItems, { fallbackNoteId: noteId })
    if (dedupeFromSnapshot.removedCount > 0) {
      debugLog({
        component: "AnnotationCanvas",
        action: "snapshot_items_deduped",
        metadata: {
          noteId,
          removedCount: dedupeFromSnapshot.removedCount,
          resultingCount: dedupeFromSnapshot.items.length,
        },
      })
    }
    if (dedupeFromSnapshot.warnings.length > 0) {
      dedupeFromSnapshot.warnings.forEach(warning => {
        debugLog({
          component: "AnnotationCanvas",
          action: "snapshot_dedupe_warning",
          metadata: {
            noteId,
            code: warning.code,
            panelId: warning.panelId ?? null,
            storeKey: warning.storeKey ?? null,
          },
          content_preview: warning.message,
        })
      })
      updateDedupeWarnings(dedupeFromSnapshot.warnings, { append: true })
    }
    restoredItems = dedupeFromSnapshot.items

    const mainPanelItem = restoredItems.find(item => item.itemType === "panel" && item.panelId === "main")
    if (mainPanelItem && primaryHydrationStatus.panels.length > 0) {
      const dbPanel = primaryHydrationStatus.panels.find(p => p.id === "main")
      if (dbPanel) {
        const posDiff =
          Math.abs(mainPanelItem.position.x - dbPanel.position.x) +
          Math.abs(mainPanelItem.position.y - dbPanel.position.y)
        if (posDiff > 1000) {
          debugLog({
            component: "AnnotationCanvas",
            action: "CORRUPTED_SNAPSHOT_DETECTED",
            metadata: {
              snapshotPosition: mainPanelItem.position,
              dbPosition: dbPanel.position,
              difference: posDiff,
              action: "using_database_position",
            },
          })
          restoredItems = restoredItems.map(item =>
            item.itemType === "panel" && item.panelId === "main"
              ? { ...item, position: dbPanel.position }
              : item,
          )
        }
      }
    }

    const finalMainPanelItem = restoredItems.find(item => item.itemType === "panel" && item.panelId === "main")
    debugLog({
      component: "AnnotationCanvas",
      action: "SNAPSHOT_RESTORE_DETAILS",
      metadata: {
        viewport: { x: restoredTranslateX, y: restoredTranslateY, zoom: restoredZoom },
        mainPanelPosition: finalMainPanelItem?.position,
        screenPosition: finalMainPanelItem?.position
          ? {
              x: (finalMainPanelItem.position.x + restoredTranslateX) * restoredZoom,
              y: (finalMainPanelItem.position.y + restoredTranslateY) * restoredZoom,
            }
          : null,
        totalItems: restoredItems.length,
      },
    })

    debugLog({
      component: "AnnotationCanvas",
      action: "SNAPSHOT_RESTORE_SETTING_CANVAS_ITEMS",
      metadata: {
        noteId,
        itemCount: restoredItems.length,
        mainPanelPosition: restoredItems.find(item => item.itemType === "panel" && item.panelId === "main")?.position,
        allPanelPositions: restoredItems
          .filter(item => item.itemType === "panel")
          .map(item => ({
            panelId: item.panelId,
            noteId: item.noteId,
            position: item.position,
          })),
      },
    })

    setCanvasItems(prev => {
      const otherNotesItems = prev.filter(item => {
        const itemNoteId = getItemNoteId(item)
        return itemNoteId && itemNoteId !== noteId
      })

      debugLog({
        component: "AnnotationCanvas",
        action: "SNAPSHOT_RESTORE_MERGE",
        metadata: {
          noteId,
          restoredItemsCount: restoredItems.length,
          otherNotesItemsCount: otherNotesItems.length,
          totalItemsCount: otherNotesItems.length + restoredItems.length,
        },
      })

      return [...otherNotesItems, ...restoredItems]
    })

    const mainPanel = restoredItems.find(item => item.itemType === "panel" && item.panelId === "main")
    if (plainProvider && mainPanel?.position) {
      const mainStoreKey = ensurePanelKey(noteId, "main")
      const mainBranch = dataStore.get(mainStoreKey)
      if (mainBranch) {
        mainBranch.position = { ...mainPanel.position }
        dataStore.set(mainStoreKey, mainBranch)
        debugLog({
          component: "AnnotationCanvas",
          action: "restored_datastore_main_position",
          metadata: { noteId, position: mainBranch.position },
        })
      }
    }

    debugLog({
      component: "AnnotationCanvas",
      action: "snapshot_viewport_restored",
      metadata: {
        noteId,
        translateX: restoredTranslateX,
        translateY: restoredTranslateY,
        zoom: restoredZoom,
        items: restoredItems.length,
      },
    })

    setIsStateLoaded(true)
    onSnapshotLoadComplete?.()
    onSnapshotSettled?.(noteId)

    setTimeout(() => {
      const runVisibilityCheck = () => {
        const panel = restoredItems.find(item => item.itemType === "panel" && item.panelId === "main")
        if (!panel?.position) {
          return
        }

        const latestState = canvasStateRef.current
        const panelPosition = panel.position
        const panelDimensions = panel.dimensions ?? DEFAULT_PANEL_DIMENSIONS
        const camera = {
          translateX: latestState.translateX ?? 0,
          translateY: latestState.translateY ?? 0,
          zoom: latestState.zoom ?? 1,
        }
        const isPanelVisible = isPanelVisibleInViewport(panelPosition, panelDimensions, camera)
        const isNewlyOpenedNote = freshNoteSeeds?.[noteId] !== undefined
        const shouldCenter = isNewlyOpenedNote || !isPanelVisible

        debugLog({
          component: "AnnotationCanvas",
          action: "auto_center_visibility_check",
          metadata: {
            noteId,
            isNewlyOpened: isNewlyOpenedNote,
            isPanelVisible,
            panelPosition,
            camera,
          },
        })

        if (shouldCenter) {
          const mainStoreKey = ensurePanelKey(noteId, "main")
          panToPanel(
            mainStoreKey,
            id => (id === mainStoreKey ? panelPosition : null),
            { x: camera.translateX, y: camera.translateY, zoom: camera.zoom },
            newState => {
              if (newState.x !== undefined && newState.y !== undefined) {
                setCanvasState(prev => ({
                  ...prev,
                  translateX: newState.x!,
                  translateY: newState.y!,
                }))
              }
            },
          )
          debugLog({
            component: "AnnotationCanvas",
            action: "auto_center_on_snapshot_restore",
            metadata: {
              noteId,
              panelPosition,
              reason: isNewlyOpenedNote ? "newly_opened_note" : "note_not_visible_in_viewport",
              isPanelVisible,
            },
          })
        } else {
          debugLog({
            component: "AnnotationCanvas",
            action: "skipped_auto_center",
            metadata: {
              noteId,
              panelPosition,
              reason: "panel_already_visible_in_viewport",
              isPanelVisible: true,
            },
          })
        }
      }

      if (typeof window !== "undefined") {
        requestAnimationFrame(runVisibilityCheck)
      } else {
        runVisibilityCheck()
      }
    }, 100)
  }, [
    noteId,
    onSnapshotLoadComplete,
    onSnapshotSettled,
    activeWorkspaceVersion,
  ])
}

function isPanelVisibleInViewport(
  panelPosition: { x: number; y: number },
  panelDimensions: { width: number; height: number },
  camera: { translateX: number; translateY: number; zoom: number },
) {
  if (typeof window === "undefined") return false

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  const panelScreenX = (panelPosition.x + camera.translateX) * camera.zoom
  const panelScreenY = (panelPosition.y + camera.translateY) * camera.zoom
  const panelScreenWidth = panelDimensions.width * camera.zoom
  const panelScreenHeight = panelDimensions.height * camera.zoom

  const isHorizontallyVisible = panelScreenX + panelScreenWidth > 0 && panelScreenX < viewportWidth
  const isVerticallyVisible = panelScreenY + panelScreenHeight > 0 && panelScreenY < viewportHeight

  return isHorizontallyVisible && isVerticallyVisible
}
