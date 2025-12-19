/**
 * Workspace hydration management.
 * Handles loading workspace state from database and initial setup.
 *
 * Extracted from use-note-workspaces.ts for maintainability.
 * @see docs/proposal/refactor/use-note-workspaces/REFACTORING_PLAN.md
 */

import { useCallback, useEffect } from "react"
import type { WorkspaceRefs } from "./workspace-refs"
import type { NoteWorkspaceSlot } from "@/lib/workspace/types"
import type { NoteWorkspaceAdapter, NoteWorkspaceSummary } from "@/lib/adapters/note-workspace-adapter"
import type {
  NoteWorkspacePayload,
  NoteWorkspacePanelSnapshot,
  NoteWorkspaceComponentSnapshot,
} from "@/lib/types/note-workspace"
import type { NoteWorkspaceSnapshot } from "@/lib/note-workspaces/state"
import type { LayerContextValue } from "@/components/canvas/layer-provider"
import type { CanvasState } from "@/lib/hooks/annotation/use-workspace-canvas-state"
import { NoteWorkspaceAdapter as NoteWorkspaceAdapterClass } from "@/lib/adapters/note-workspace-adapter"
import { getWorkspaceLayerManager } from "@/lib/workspace/workspace-layer-manager-registry"
import {
  markWorkspaceHydrated,
  markWorkspaceHydrating,
  markWorkspaceUnhydrated,
  populateRuntimeComponents,
  setRuntimeVisible,
  setWorkspaceEntry,
  markWorkspaceAsDefault,
} from "@/lib/workspace/runtime-manager"
import {
  restoreComponentsToWorkspace,
} from "@/lib/workspace/store-runtime-bridge"
// Phase 3 Unified Durability: Lifecycle management
import {
  beginWorkspaceRestore,
  completeWorkspaceRestore,
  isWorkspaceLifecycleReady,
  removeWorkspaceLifecycle,
} from "@/lib/workspace/durability"
import {
  cacheWorkspaceSnapshot,
  subscribeToWorkspaceListRefresh,
  getActiveWorkspaceContext,
} from "@/lib/note-workspaces/state"
import {
  getActiveEntryContext,
} from "@/lib/entry"
import {
  DEFAULT_CAMERA,
  serializeWorkspacePayload,
  serializePanelSnapshots,
  ensureWorkspaceSnapshotCache,
  formatSyncedLabel,
} from "./workspace-utils"

// ============================================================================
// Types
// ============================================================================

export interface UseWorkspaceHydrationOptions {
  /** All workspace refs from useWorkspaceRefs */
  refs: WorkspaceRefs
  /** Whether feature is enabled */
  featureEnabled: boolean
  /** Whether flag is enabled */
  flagEnabled: boolean
  /** Whether live state feature is enabled */
  liveStateEnabled: boolean
  /** Whether v2 features are enabled */
  v2Enabled: boolean
  /** Whether workspace is ready */
  isWorkspaceReady: boolean
  /** Whether workspace is unavailable */
  isUnavailable: boolean
  /** Debug log emitter function */
  emitDebugLog: (payload: {
    component: string
    action: string
    metadata?: Record<string, unknown>
  }) => void
  /** Current workspace ID from state */
  currentWorkspaceId: string | null
  /** Layer context */
  layerContext: LayerContextValue | null
  /** Open notes from provider */
  openNotes: NoteWorkspaceSlot[]

  // State setters
  /** Set workspaces list */
  setWorkspaces: React.Dispatch<React.SetStateAction<NoteWorkspaceSummary[]>>
  /** Set current workspace ID */
  setCurrentWorkspaceId: (id: string | null) => void
  /** Set is loading */
  setIsLoading: (loading: boolean) => void
  /** Set status helper text */
  setStatusHelperText: (text: string) => void
  /** Set active note ID */
  setActiveNoteId: (id: string | null) => void
  /** Set canvas state */
  setCanvasState: React.Dispatch<React.SetStateAction<CanvasState>> | null
  /** Mark unavailable */
  markUnavailable: (reason?: string) => void
  /** Bump snapshot revision */
  bumpSnapshotRevision: () => void

  // Functions from membership hook
  /** Set workspace note membership */
  setWorkspaceNoteMembership: (
    workspaceId: string | null | undefined,
    noteIds: Iterable<string | null | undefined>,
    timestamp?: number,
  ) => void
  /** Commit workspace open notes */
  commitWorkspaceOpenNotes: (
    workspaceId: string | null | undefined,
    slots: Iterable<{
      noteId?: string | null
      mainPosition?: { x: number; y: number } | null
      position?: { x: number; y: number } | null
    }> | null | undefined,
    options?: {
      updateMembership?: boolean
      updateCache?: boolean
      timestamp?: number
      callSite?: string
    },
  ) => NoteWorkspaceSlot[]

  // Functions from panel snapshots hook
  /** Filter panels for workspace */
  filterPanelsForWorkspace: (
    workspaceId: string | null | undefined,
    panels: NoteWorkspacePanelSnapshot[],
  ) => NoteWorkspacePanelSnapshot[]
  /** Update panel snapshot map */
  updatePanelSnapshotMap: (
    panels: NoteWorkspacePanelSnapshot[],
    reason: string,
    options?: { allowEmpty?: boolean; mergeWithExisting?: boolean },
  ) => void

  // Functions from snapshot hook
  /** Apply panel snapshots */
  applyPanelSnapshots: (
    panels: NoteWorkspacePanelSnapshot[] | undefined,
    targetNoteIds: Set<string>,
    components?: NoteWorkspaceComponentSnapshot[],
    options?: {
      allowEmptyApply?: boolean
      clearWorkspace?: boolean
      suppressMutationEvents?: boolean
      clearComponents?: boolean
      reason?: string
    },
  ) => void

  // Note operations
  /** Open workspace note */
  openWorkspaceNote: (
    noteId: string,
    options?: {
      mainPosition?: { x: number; y: number }
      persist?: boolean
      persistPosition?: boolean
      workspaceId?: string
    },
  ) => Promise<void>
  /** Close workspace note */
  closeWorkspaceNote: (
    noteId: string,
    options?: { persist?: boolean; removeWorkspace?: boolean },
  ) => Promise<void>
}

export interface UseWorkspaceHydrationResult {
  /** Hydrate workspace from database */
  hydrateWorkspace: (workspaceId: string) => Promise<void>
}

// ============================================================================
// Hook
// ============================================================================

export function useWorkspaceHydration(
  options: UseWorkspaceHydrationOptions,
): UseWorkspaceHydrationResult {
  const {
    refs,
    featureEnabled,
    flagEnabled,
    liveStateEnabled,
    v2Enabled,
    isWorkspaceReady,
    isUnavailable,
    emitDebugLog,
    currentWorkspaceId,
    layerContext,
    openNotes,
    setWorkspaces,
    setCurrentWorkspaceId,
    setIsLoading,
    setStatusHelperText,
    setActiveNoteId,
    setCanvasState,
    markUnavailable,
    bumpSnapshotRevision,
    setWorkspaceNoteMembership,
    commitWorkspaceOpenNotes,
    filterPanelsForWorkspace,
    updatePanelSnapshotMap,
    applyPanelSnapshots,
    openWorkspaceNote,
    closeWorkspaceNote,
  } = options

  const {
    adapterRef,
    workspaceSnapshotsRef,
    lastNonEmptySnapshotsRef,
    lastPreviewedSnapshotRef,
    lastComponentsSnapshotRef,
    snapshotOwnerWorkspaceIdRef,
    workspaceRevisionRef,
    lastPanelSnapshotHashRef,
    lastSavedPayloadHashRef,
    skipSavesUntilRef,
    isHydratingRef,
    lastHydratedWorkspaceIdRef,
    listedOnceRef,
    saveTimeoutRef,
  } = refs

  // ---------------------------------------------------------------------------
  // hydrateWorkspace
  // ---------------------------------------------------------------------------
  const hydrateWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!adapterRef.current) return
      setIsLoading(true)
      const hydrateStart = Date.now()
      const wasReadyBeforeLoad = isWorkspaceLifecycleReady(workspaceId)
      isHydratingRef.current = true

      // Phase 3 Unified Durability: Mark lifecycle as restoring BEFORE load
      // This blocks persistence during hydration and enables proper hot/cold detection
      if (liveStateEnabled) {
        beginWorkspaceRestore(workspaceId, "hydrate_workspace")
        markWorkspaceHydrating(workspaceId, "hydrate_workspace")
      }
      try {
        const record = await adapterRef.current.loadWorkspace(workspaceId)
        snapshotOwnerWorkspaceIdRef.current = workspaceId
        workspaceRevisionRef.current.set(workspaceId, (record as any).revision ?? null)
        const declaredNoteIds = new Set(
          record.payload.openNotes.map((entry) => entry.noteId).filter((noteId): noteId is string => Boolean(noteId)),
        )
        const incomingPanels = record.payload.panels ?? []
        if (declaredNoteIds.size === 0) {
          incomingPanels.forEach((panel) => {
            if (panel.noteId) {
              declaredNoteIds.add(panel.noteId)
            }
          })
        }
        setWorkspaceNoteMembership(workspaceId, declaredNoteIds)
        const scopedPanels = filterPanelsForWorkspace(workspaceId, incomingPanels)
        const targetIds = new Set<string>(declaredNoteIds)
        scopedPanels.forEach((panel) => {
          if (panel.noteId) {
            targetIds.add(panel.noteId)
          }
        })
        const incomingComponents = record.payload.components ?? []
        const resolvedComponents =
          incomingComponents && incomingComponents.length > 0
            ? incomingComponents
            : lastComponentsSnapshotRef.current.get(workspaceId) ?? incomingComponents
        updatePanelSnapshotMap(scopedPanels, "hydrate_workspace", { allowEmpty: true })
        const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, workspaceId)
        cache.panels = scopedPanels
        cache.components = resolvedComponents ?? []
        const normalizedSnapshotOpenNotes = record.payload.openNotes.map((entry) => ({
          noteId: entry.noteId,
          mainPosition: entry.position ?? null,
        }))
        cache.openNotes = normalizedSnapshotOpenNotes
        commitWorkspaceOpenNotes(workspaceId, normalizedSnapshotOpenNotes, { callSite: "restoreWorkspace" })
        lastPanelSnapshotHashRef.current = serializePanelSnapshots(scopedPanels)
        if (resolvedComponents && resolvedComponents.length > 0) {
          lastComponentsSnapshotRef.current.set(workspaceId, resolvedComponents)
          // Phase 3: Restore components via bridge (handles hot/cold detection + cold restore invariant)
          // This ensures components are restored to both the new store and legacy runtime ledger
          restoreComponentsToWorkspace(workspaceId, resolvedComponents, {
            forceRestoreType: 'cold', // Hydration from DB is always cold restore
          })
          // Legacy fallback: Also populate runtime ledger directly for backward compatibility
          populateRuntimeComponents(workspaceId, resolvedComponents)
        }
        const panelNoteIds = new Set(scopedPanels.map((panel) => panel.noteId).filter(Boolean) as string[])
        panelNoteIds.forEach((id) => targetIds.add(id))
        applyPanelSnapshots(scopedPanels, panelNoteIds, resolvedComponents, {
          allowEmptyApply: true,
          suppressMutationEvents: true,
          reason: "hydrate_workspace",
        })
        const closePromises = openNotes
          .filter((note) => !targetIds.has(note.noteId))
          .map((note) =>
            closeWorkspaceNote(note.noteId, { persist: false, removeWorkspace: false }).catch(() => {}),
          )
        await Promise.all(closePromises)

        for (const panel of record.payload.openNotes) {
          const alreadyOpen = openNotes.some((note) => note.noteId === panel.noteId)
          if (!alreadyOpen) {
            await openWorkspaceNote(panel.noteId, {
              mainPosition: panel.position ?? undefined,
              persist: false,
              persistPosition: false,
              workspaceId,
            })
          }
        }

        const nextActive = record.payload.activeNoteId || record.payload.openNotes[0]?.noteId || null
        setActiveNoteId(nextActive)

        snapshotOwnerWorkspaceIdRef.current = workspaceId

        const nextCamera = record.payload.camera ?? DEFAULT_CAMERA
        if (layerContext?.setTransform) {
          layerContext.setTransform("notes", nextCamera)
        }
        if (setCanvasState) {
          setCanvasState((prev) => ({
            ...prev,
            translateX: nextCamera.x,
            translateY: nextCamera.y,
            zoom: nextCamera.scale,
          }))
        }

        if (v2Enabled) {
          cacheWorkspaceSnapshot({
            workspaceId,
            revision: record.revision ?? null,
            panels: incomingPanels,
            openNotes: record.payload.openNotes.map((entry) => ({
              noteId: entry.noteId,
              mainPosition: entry.position ?? null,
            })),
            camera: nextCamera,
            activeNoteId: nextActive,
          })
          lastPreviewedSnapshotRef.current.delete(workspaceId)
        }

        setStatusHelperText(formatSyncedLabel(record.updatedAt))
        setWorkspaces((prev) =>
          prev.map((workspace) =>
            workspace.id === record.id
              ? {
                  ...workspace,
                  revision: record.revision,
                  updatedAt: record.updatedAt,
                  noteCount: record.noteCount,
              }
            : workspace,
        ),
        )
        lastSavedPayloadHashRef.current.set(workspaceId, serializeWorkspacePayload(record.payload))

        // FIX: Set save cooldown after hydration to prevent race condition.
        // When bumpSnapshotRevision() triggers panelSnapshotVersion change, the components_changed
        // effect runs in the next render cycle. By that time, isHydratingRef.current is already false.
        // Setting a cooldown ensures persistWorkspaceById will skip saves for a short period after
        // hydration, preventing the effect from saving empty/incomplete data.
        skipSavesUntilRef.current.set(workspaceId, Date.now() + 500)

        emitDebugLog({
          component: "NoteWorkspace",
          action: "hydrate_success",
          metadata: {
            workspaceId,
            panelCount: incomingPanels.length,
            openCount: record.payload.openNotes.length,
            componentCount: resolvedComponents?.length ?? 0,
            durationMs: Date.now() - hydrateStart,
            saveCooldownSet: true,
          },
        })
        if (liveStateEnabled) {
          markWorkspaceHydrated(workspaceId, "hydrate_workspace")
          // Phase 3 Unified Durability: Complete lifecycle transition to 'ready'
          // This happens AFTER both notes/panels AND components are restored
          // (restoreComponentsToWorkspace was called earlier, now lifecycle is complete)
          completeWorkspaceRestore(workspaceId, "hydrate_workspace")
        }
        bumpSnapshotRevision()

        // Phase 2: Mark runtime visible after initial hydration completes
        if (liveStateEnabled) {
          setRuntimeVisible(workspaceId, true)

          // Phase 5: Associate workspace with current entry for cross-entry state handling
          const entryId = getActiveEntryContext()
          if (entryId) {
            setWorkspaceEntry(workspaceId, entryId)
            // Check if this is the default workspace for its entry
            if (record.isDefault) {
              markWorkspaceAsDefault(workspaceId)
            }
          }

          emitDebugLog({
            component: "NoteWorkspace",
            action: "workspace_runtime_visible",
            metadata: { workspaceId, wasCold: true, source: "hydrate_workspace", entryId },
          })
        }
      } catch (error) {
        console.error("[NoteWorkspace] hydrate failed", error)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "hydrate_error",
          metadata: {
            workspaceId,
            error: error instanceof Error ? error.message : String(error),
          },
        })
        if (liveStateEnabled) {
          // Phase 3: Clear lifecycle state on error so next attempt starts fresh
          // This prevents getting stuck in 'restoring' state
          removeWorkspaceLifecycle(workspaceId)
          if (wasReadyBeforeLoad) {
            markWorkspaceHydrated(workspaceId, "hydrate_workspace_error")
          } else {
            markWorkspaceUnhydrated(workspaceId, "hydrate_workspace_error")
          }
        }
      } finally {
        isHydratingRef.current = false
        snapshotOwnerWorkspaceIdRef.current = workspaceId
        setIsLoading(false)
      }
    },
    [
      adapterRef,
      applyPanelSnapshots,
      bumpSnapshotRevision,
      closeWorkspaceNote,
      commitWorkspaceOpenNotes,
      emitDebugLog,
      filterPanelsForWorkspace,
      isHydratingRef,
      lastComponentsSnapshotRef,
      lastPanelSnapshotHashRef,
      lastPreviewedSnapshotRef,
      lastSavedPayloadHashRef,
      layerContext,
      liveStateEnabled,
      openNotes,
      openWorkspaceNote,
      setActiveNoteId,
      setCanvasState,
      setIsLoading,
      setStatusHelperText,
      setWorkspaceNoteMembership,
      setWorkspaces,
      skipSavesUntilRef,
      snapshotOwnerWorkspaceIdRef,
      updatePanelSnapshotMap,
      v2Enabled,
      workspaceRevisionRef,
      workspaceSnapshotsRef,
    ],
  )

  // ---------------------------------------------------------------------------
  // Initial workspace list effect
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!flagEnabled || isUnavailable) return
    if (listedOnceRef.current) return
    adapterRef.current = new NoteWorkspaceAdapterClass()
    let cancelled = false
    emitDebugLog({
      component: "NoteWorkspace",
      action: "list_start",
    })
    ;(async () => {
      try {
        let list = await adapterRef.current!.listWorkspaces()
        if (list.length === 0) {
          try {
            await adapterRef.current!.ensureDefaultWorkspace()
            list = await adapterRef.current!.listWorkspaces()
          } catch (seedError) {
            console.warn("[NoteWorkspace] failed to seed default workspace", seedError)
          }
        }
        if (cancelled) return
        listedOnceRef.current = true
        setWorkspaces(list)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "list_success",
          metadata: { count: list.length },
        })
        if (!currentWorkspaceId) {
          // Check for pending workspace context first (e.g., from Dashboard navigation)
          const pendingWorkspaceId = getActiveWorkspaceContext()
          const pendingWorkspace = pendingWorkspaceId
            ? list.find((ws) => ws.id === pendingWorkspaceId)
            : null

          // Use pending workspace if valid, otherwise fall back to default
          const targetWorkspace = pendingWorkspace
            ?? list.find((workspace) => workspace.isDefault)
            ?? list[0]

          if (targetWorkspace) {
            snapshotOwnerWorkspaceIdRef.current = targetWorkspace.id
            setCurrentWorkspaceId(targetWorkspace.id)
            emitDebugLog({
              component: "NoteWorkspace",
              action: "initial_workspace_selected",
              metadata: {
                targetWorkspaceId: targetWorkspace.id,
                targetWorkspaceName: targetWorkspace.name,
                usedPendingContext: !!pendingWorkspace,
                pendingWorkspaceId,
              },
            })
          }
        }
      } catch (error) {
        console.warn(
          "[NoteWorkspace] failed to list",
          error instanceof Error ? error.message : error,
        )
        if (cancelled) return
        listedOnceRef.current = true
        setWorkspaces([])
        emitDebugLog({
          component: "NoteWorkspace",
          action: "list_error",
          metadata: { error: error instanceof Error ? error.message : String(error) },
        })
        markUnavailable(error instanceof Error ? error.message : undefined)
      }
    })()
    return () => {
      cancelled = true
      // Phase 2: Clear all per-workspace timeouts on unmount
      saveTimeoutRef.current.forEach((timeout) => {
        clearTimeout(timeout)
      })
      saveTimeoutRef.current.clear()
    }
  }, [
    adapterRef,
    currentWorkspaceId,
    emitDebugLog,
    flagEnabled,
    isUnavailable,
    listedOnceRef,
    markUnavailable,
    saveTimeoutRef,
    setCurrentWorkspaceId,
    setWorkspaces,
    snapshotOwnerWorkspaceIdRef,
  ])

  // ---------------------------------------------------------------------------
  // Workspace list refresh subscription
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!flagEnabled || isUnavailable) return
    if (!adapterRef.current) return

    const handleRefresh = async () => {
      try {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "refresh_list_requested",
        })
        const list = await adapterRef.current!.listWorkspaces()
        setWorkspaces(list)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "refresh_list_success",
          metadata: { count: list.length },
        })
      } catch (error) {
        console.warn("[NoteWorkspace] refresh failed", error)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "refresh_list_error",
          metadata: { error: error instanceof Error ? error.message : String(error) },
        })
      }
    }

    const unsubscribe = subscribeToWorkspaceListRefresh(handleRefresh)
    return () => {
      unsubscribe()
    }
  }, [adapterRef, emitDebugLog, flagEnabled, isUnavailable, setWorkspaces])

  // ---------------------------------------------------------------------------
  // Hydration trigger effect
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!featureEnabled || !isWorkspaceReady || !currentWorkspaceId) return
    if (lastHydratedWorkspaceIdRef.current === currentWorkspaceId) return

    // Step 7 COMPLETE: Use lifecycle state as SOLE hot/cold discriminator
    // If lifecycle is 'ready', workspace is fully restored (hot) - skip hydration
    // If lifecycle is NOT 'ready', proceed with cold hydration from DB
    if (liveStateEnabled && isWorkspaceLifecycleReady(currentWorkspaceId)) {
      emitDebugLog({
        component: "NoteWorkspace",
        action: "hydrate_skipped_lifecycle_ready",
        metadata: {
          workspaceId: currentWorkspaceId,
          reason: "workspace_lifecycle_is_ready",
        },
      })
      return
    }

    // Lifecycle is NOT ready - proceed with cold hydration
    lastHydratedWorkspaceIdRef.current = currentWorkspaceId
    emitDebugLog({
      component: "NoteWorkspace",
      action: "hydrate_on_route_load",
      metadata: {
        workspaceId: currentWorkspaceId,
        lastHydratedWorkspaceId: lastHydratedWorkspaceIdRef.current,
      },
    })
    hydrateWorkspace(currentWorkspaceId)
  }, [
    currentWorkspaceId,
    emitDebugLog,
    featureEnabled,
    hydrateWorkspace,
    isWorkspaceReady,
    lastHydratedWorkspaceIdRef,
    liveStateEnabled,
  ])

  return {
    hydrateWorkspace,
  }
}
