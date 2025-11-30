"use client"

import { useEffect, useRef } from "react"
import type { Dispatch, SetStateAction } from "react"

import type { CanvasItem } from "@/types/canvas-items"
import { createPanelItem } from "@/types/canvas-items"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { debugLog } from "@/lib/utils/debug-logger"

type HydrationPanel = {
  id: string
  noteId?: string
  position: { x: number; y: number }
  dimensions?: { width: number; height: number }
  metadata?: Record<string, unknown>
  state?: string
  type?: string
}

type UseNonMainPanelHydrationOptions = {
  noteIds: string[]
  canvasItems: CanvasItem[]
  setCanvasItems: Dispatch<SetStateAction<CanvasItem[]>>
  workspaceSnapshotRevision: number
  enabled?: boolean
  hydrationInProgressRef?: React.MutableRefObject<boolean>
  workspaceRestorationInProgressRef?: React.MutableRefObject<boolean>
}

/**
 * Hydrates non-main panels from the database after workspace restoration.
 *
 * When switching workspaces, workspace snapshots only contain main panel positions.
 * This hook fetches non-main panels (annotation/branch panels) from the database
 * for each note in the workspace and adds them to the canvas.
 */
export function useNonMainPanelHydration({
  noteIds,
  canvasItems,
  setCanvasItems,
  workspaceSnapshotRevision,
  enabled = true,
  hydrationInProgressRef,
  workspaceRestorationInProgressRef,
}: UseNonMainPanelHydrationOptions) {
  // FIX 13: Initialize to null so we ALWAYS detect first mount.
  // Previously initialized to workspaceSnapshotRevision, which meant:
  // - Canvas mounts at revision X
  // - lastRevisionRef.current = X (initialized)
  // - revisionChanged = (X !== X) = false
  // - Hydration never runs on first mount!
  // - workspaceRestorationInProgressRef stays true forever
  // With null initialization, first mount always triggers hydration.
  const lastRevisionRef = useRef<number | null>(null)
  const hydratedRevisionRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    const isFirstMount = lastRevisionRef.current === null
    const revisionChanged = lastRevisionRef.current !== workspaceSnapshotRevision
    lastRevisionRef.current = workspaceSnapshotRevision

    // FIX 13: Run hydration on first mount OR revision change
    // First mount is critical - it clears workspaceRestorationInProgressRef
    if (!isFirstMount && !revisionChanged) return

    // Skip if we already hydrated this revision
    if (hydratedRevisionRef.current === workspaceSnapshotRevision) return

    // Set flag to prevent canvas sync from filtering while we're hydrating
    if (hydrationInProgressRef) {
      hydrationInProgressRef.current = true
    }

    debugLog({
      component: "NonMainPanelHydration",
      action: "starting_hydration",
      metadata: {
        noteIds,
        workspaceSnapshotRevision,
        currentCanvasItemsCount: canvasItems.length,
        // FIX 13: Log whether this is first mount to verify fix is working
        isFirstMount,
        revisionChanged,
      },
    })

    // Fetch non-main panels for all notes in the workspace
    const fetchPromises = noteIds.map(async (noteId) => {
      try {
        const response = await fetch(`/api/canvas/layout/${noteId}`)
        if (!response.ok) {
          debugLog({
            component: "NonMainPanelHydration",
            action: "fetch_failed",
            metadata: {
              noteId,
              status: response.status,
              statusText: response.statusText,
            },
          })
          return { noteId, panels: [] }
        }

        const data = await response.json()
        const panels = (data.panels || []) as HydrationPanel[]

        debugLog({
          component: "NonMainPanelHydration",
          action: "fetched_panels",
          metadata: {
            noteId,
            totalPanels: panels.length,
            panelIds: panels.map(p => p.id),
          },
        })

        return { noteId, panels }
      } catch (error) {
        debugLog({
          component: "NonMainPanelHydration",
          action: "fetch_error",
          metadata: {
            noteId,
            error: error instanceof Error ? error.message : String(error),
          },
        })
        return { noteId, panels: [] }
      }
    })

    Promise.all(fetchPromises).then((results) => {
      // Collect all non-main panels
      const nonMainPanelsToAdd: CanvasItem[] = []

      results.forEach(({ noteId, panels }) => {
        // Filter out main panels (already handled by useCanvasNoteSync)
        const nonMainPanels = panels.filter(p => p.id !== "main")

        nonMainPanels.forEach(panel => {
          const panelId = panel.id
          const storeKey = ensurePanelKey(noteId, panelId)
          const position = panel.position || { x: 0, y: 0 }
          const dimensions = panel.dimensions || { width: 500, height: 400 }

          const canvasItem = createPanelItem(
            panelId,
            position,
            "note", // panelType
            noteId,
            storeKey,
          )

          // Update dimensions if provided
          if (panel.dimensions) {
            canvasItem.dimensions = panel.dimensions
          }

          nonMainPanelsToAdd.push(canvasItem)
        })
      })

      if (nonMainPanelsToAdd.length === 0) {
        debugLog({
          component: "NonMainPanelHydration",
          action: "no_panels_to_add",
          metadata: {
            noteIds,
            workspaceSnapshotRevision,
          },
        })
        hydratedRevisionRef.current = workspaceSnapshotRevision
        // Clear flags - hydration complete (no panels to add)
        if (hydrationInProgressRef) {
          hydrationInProgressRef.current = false
        }
        if (workspaceRestorationInProgressRef) {
          workspaceRestorationInProgressRef.current = false
          debugLog({
            component: "NonMainPanelHydration",
            action: "workspace_restoration_completed",
            metadata: {
              reason: "no_panels_to_hydrate",
              workspaceSnapshotRevision,
            },
          })
        }
        return
      }

      debugLog({
        component: "NonMainPanelHydration",
        action: "adding_non_main_panels",
        metadata: {
          panelsToAdd: nonMainPanelsToAdd.length,
          panelIds: nonMainPanelsToAdd.map(p => p.panelId),
          noteIds: [...new Set(nonMainPanelsToAdd.map(p => p.noteId))],
        },
      })

      // Add non-main panels to canvas items
      setCanvasItems(prev => {
        // Check if panels already exist to avoid duplicates
        const existingPanelKeys = new Set(
          prev
            .filter(item => item.itemType === "panel")
            .map(item => item.storeKey)
        )

        const newPanels = nonMainPanelsToAdd.filter(
          panel => !existingPanelKeys.has(panel.storeKey)
        )

        if (newPanels.length === 0) {
          debugLog({
            component: "NonMainPanelHydration",
            action: "all_panels_already_exist",
            metadata: {
              attempted: nonMainPanelsToAdd.length,
            },
          })
          return prev
        }

        debugLog({
          component: "NonMainPanelHydration",
          action: "panels_added_to_canvas",
          metadata: {
            previousCount: prev.length,
            addedCount: newPanels.length,
            newCount: prev.length + newPanels.length,
            addedPanelIds: newPanels.map(p => p.panelId),
          },
        })

        return [...prev, ...newPanels]
      })

      hydratedRevisionRef.current = workspaceSnapshotRevision

      // Clear flags - hydration complete
      if (hydrationInProgressRef) {
        hydrationInProgressRef.current = false
      }
      if (workspaceRestorationInProgressRef) {
        workspaceRestorationInProgressRef.current = false
        debugLog({
          component: "NonMainPanelHydration",
          action: "workspace_restoration_completed",
          metadata: {
            reason: "hydration_successful",
            workspaceSnapshotRevision,
            panelsAdded: nonMainPanelsToAdd.length,
          },
        })
      }
    }).catch((error) => {
      debugLog({
        component: "NonMainPanelHydration",
        action: "hydration_error",
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })

      // Clear flags even on error
      if (hydrationInProgressRef) {
        hydrationInProgressRef.current = false
      }
      if (workspaceRestorationInProgressRef) {
        workspaceRestorationInProgressRef.current = false
        debugLog({
          component: "NonMainPanelHydration",
          action: "workspace_restoration_completed",
          metadata: {
            reason: "hydration_error",
            error: error instanceof Error ? error.message : String(error),
          },
        })
      }
    })
  }, [noteIds, canvasItems, setCanvasItems, workspaceSnapshotRevision, enabled])
}
