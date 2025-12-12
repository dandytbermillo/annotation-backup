/**
 * Workspace persistence management.
 * Handles saving workspace state to database, scheduling saves, and entry changes.
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
import type { WorkspacePanelSnapshot } from "@/lib/hooks/annotation/use-workspace-panel-positions"
import { getWorkspaceLayerManager } from "@/lib/workspace/workspace-layer-manager-registry"
import {
  listRuntimeComponents,
  getDeletedComponents,
} from "@/lib/workspace/runtime-manager"
import {
  subscribeToWorkspaceSnapshotState,
} from "@/lib/note-workspaces/state"
import {
  subscribeToActiveEntryContext,
  setActiveEntryContext,
} from "@/lib/entry"
import {
  DEFAULT_CAMERA,
  serializeWorkspacePayload,
  getLastNonEmptySnapshot,
  formatSyncedLabel,
} from "./workspace-utils"

// ============================================================================
// Types
// ============================================================================

export interface UseWorkspacePersistenceOptions {
  /** All workspace refs from useWorkspaceRefs */
  refs: WorkspaceRefs
  /** Whether feature is enabled */
  featureEnabled: boolean
  /** Whether live state feature is enabled */
  liveStateEnabled: boolean
  /** Whether v2 features are enabled */
  v2Enabled: boolean
  /** Debug log emitter function */
  emitDebugLog: (payload: {
    component: string
    action: string
    metadata?: Record<string, unknown>
  }) => void
  /** Current workspace ID from state */
  currentWorkspaceId: string | null
  /** Current workspace summary */
  currentWorkspaceSummary: NoteWorkspaceSummary | null
  /** Current workspace summary ID (derived) */
  currentWorkspaceSummaryId: string | null
  /** Active note ID */
  activeNoteId: string | null
  /** Canvas state */
  canvasState: CanvasState | null
  /** Layer context */
  layerContext: LayerContextValue | null
  /** Open notes from provider */
  openNotes: NoteWorkspaceSlot[]
  /** Panel snapshot version */
  panelSnapshotVersion: number
  /** Current entry ID */
  currentEntryId: string | null

  // State setters
  /** Set workspaces list */
  setWorkspaces: React.Dispatch<React.SetStateAction<NoteWorkspaceSummary[]>>
  /** Set status helper text */
  setStatusHelperText: (text: string) => void
  /** Set current entry ID state */
  setCurrentEntryIdState: (entryId: string | null) => void

  // Functions from membership hook
  /** Get workspace note membership */
  getWorkspaceNoteMembership: (workspaceId: string | null | undefined) => Set<string> | null
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
  /** Get workspace open notes */
  getWorkspaceOpenNotes: (workspaceId: string | null | undefined) => NoteWorkspaceSlot[]

  // Functions from panel snapshots hook
  /** Collect panel snapshots from DataStore */
  collectPanelSnapshotsFromDataStore: (targetWorkspaceId?: string | null) => NoteWorkspacePanelSnapshot[]
  /** Get all panel snapshots */
  getAllPanelSnapshots: (options?: { useFallback?: boolean }) => NoteWorkspacePanelSnapshot[]
  /** Update panel snapshot map */
  updatePanelSnapshotMap: (
    panels: NoteWorkspacePanelSnapshot[],
    reason: string,
    options?: { allowEmpty?: boolean; mergeWithExisting?: boolean },
  ) => void
  /** Get panel snapshot for a note (from use-workspace-panel-positions) */
  getPanelSnapshot: (noteId: string) => WorkspacePanelSnapshot | null
  /** Prune workspace entries */
  pruneWorkspaceEntries: (
    workspaceId: string | null | undefined,
    observedNoteIds: Set<string>,
    reason: string,
  ) => boolean
  /** Resolve main panel position */
  resolveMainPanelPosition: (noteId: string) => { x: number; y: number } | null
  /** Wait for panel snapshot readiness */
  waitForPanelSnapshotReadiness: (
    reason: string,
    maxWaitMs?: number,
    workspaceOverride?: string | null,
  ) => Promise<boolean>

  // Functions from snapshot hook
  /** Capture current workspace snapshot */
  captureCurrentWorkspaceSnapshot: (
    workspaceId?: string | null,
    options?: {
      readinessReason?: string
      readinessMaxWaitMs?: number
      skipReadiness?: boolean
    },
  ) => Promise<void>
  /** Build payload from snapshot */
  buildPayloadFromSnapshot: (
    workspaceId: string,
    snapshot: NoteWorkspaceSnapshot,
  ) => NoteWorkspacePayload
  /** Get workspace snapshot from cache */
  getWorkspaceSnapshot: (workspaceId: string) => NoteWorkspaceSnapshot | null
  /** Cache workspace snapshot */
  cacheWorkspaceSnapshot: (snapshot: {
    workspaceId: string
    panels: NoteWorkspacePanelSnapshot[]
    components?: NoteWorkspaceComponentSnapshot[]
    openNotes: { noteId: string; mainPosition: { x: number; y: number } | null }[]
    camera: { x: number; y: number; scale: number }
    activeNoteId: string | null
  }) => void
}

export interface UseWorkspacePersistenceResult {
  /** Build workspace payload for persistence */
  buildPayload: () => NoteWorkspacePayload
  /** Persist workspace by ID */
  persistWorkspaceById: (
    targetWorkspaceId: string,
    reason: string,
    options?: { skipReadinessCheck?: boolean; isBackground?: boolean },
  ) => Promise<boolean>
  /** Persist workspace now (immediate) */
  persistWorkspaceNow: () => Promise<void>
  /** Schedule a save */
  scheduleSave: (options?: { immediate?: boolean; reason?: string }) => void
  /** Flush pending saves */
  flushPendingSave: (reason?: string) => void
  /** Handle entry change */
  handleEntryChange: (newEntryId: string | null) => void
}

// ============================================================================
// Hook
// ============================================================================

export function useWorkspacePersistence(
  options: UseWorkspacePersistenceOptions,
): UseWorkspacePersistenceResult {
  const {
    refs,
    featureEnabled,
    liveStateEnabled,
    v2Enabled,
    emitDebugLog,
    currentWorkspaceId,
    currentWorkspaceSummary,
    currentWorkspaceSummaryId,
    activeNoteId,
    canvasState,
    layerContext,
    openNotes,
    panelSnapshotVersion,
    currentEntryId,
    setWorkspaces,
    setStatusHelperText,
    setCurrentEntryIdState,
    getWorkspaceNoteMembership,
    setWorkspaceNoteMembership,
    commitWorkspaceOpenNotes,
    getWorkspaceOpenNotes,
    collectPanelSnapshotsFromDataStore,
    getAllPanelSnapshots,
    updatePanelSnapshotMap,
    getPanelSnapshot,
    pruneWorkspaceEntries,
    resolveMainPanelPosition,
    waitForPanelSnapshotReadiness,
    captureCurrentWorkspaceSnapshot,
    buildPayloadFromSnapshot,
    getWorkspaceSnapshot,
    cacheWorkspaceSnapshot,
  } = options

  const {
    adapterRef,
    workspaceRevisionRef,
    lastSavedPayloadHashRef,
    saveInFlightRef,
    skipSavesUntilRef,
    isHydratingRef,
    replayingWorkspaceRef,
    workspaceDirtyRef,
    saveTimeoutRef,
    lastSaveReasonRef,
    lastPendingTimestampRef,
    lastCameraRef,
    snapshotOwnerWorkspaceIdRef,
    currentWorkspaceIdRef,
    workspaceSnapshotsRef,
    lastNonEmptySnapshotsRef,
    lastComponentsSnapshotRef,
    lastPreviewedSnapshotRef,
    persistWorkspaceByIdRef,
    previousEntryIdRef,
  } = refs

  // ---------------------------------------------------------------------------
  // buildPayload
  // ---------------------------------------------------------------------------
  const buildPayload = useCallback((): NoteWorkspacePayload => {
    const cameraTransform =
      canvasState != null
        ? {
            x: canvasState.translateX,
            y: canvasState.translateY,
            scale: canvasState.zoom,
          }
        : layerContext?.transforms.notes ?? DEFAULT_CAMERA
    lastCameraRef.current = cameraTransform
    const workspaceIdForComponents =
      currentWorkspaceId ?? snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current
    if (!workspaceIdForComponents) {
      return {
        schemaVersion: "1.1.0",
        openNotes: [],
        activeNoteId: null,
        camera: cameraTransform,
        panels: [],
        components: [],
      }
    }
    const workspaceMembership = getWorkspaceNoteMembership(workspaceIdForComponents)
    // FIX: Use getWorkspaceOpenNotes which reads from runtime in live-state mode.
    // Previously used workspaceOpenNotesRef.current which is a legacy ref that could be stale.
    const storedOpenNotesForWorkspace = getWorkspaceOpenNotes(workspaceIdForComponents)
    let hasKnownNotes = Boolean(
      (workspaceMembership && workspaceMembership.size > 0) || storedOpenNotesForWorkspace.length > 0,
    )
    // FIX 9: Pass workspaceIdForComponents to ensure we read panels from the correct workspace's
    // DataStore. Previously, collectPanelSnapshotsFromDataStore() would independently resolve the
    // workspace ID using refs that could be stale, causing cross-workspace panel contamination.
    let panelSnapshots =
      v2Enabled && currentWorkspaceId
        ? collectPanelSnapshotsFromDataStore(workspaceIdForComponents)
        : getAllPanelSnapshots({ useFallback: false })
    const observedNoteIds = new Set(
      panelSnapshots
        .map((panel) => panel.noteId)
        .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
    )
    const workspacePruned = pruneWorkspaceEntries(workspaceIdForComponents, observedNoteIds, "build_payload")
    if (v2Enabled && workspaceIdForComponents && observedNoteIds.size > 0) {
      setWorkspaceNoteMembership(workspaceIdForComponents, observedNoteIds)
    }
    if (workspacePruned) {
      // FIX: Use getWorkspaceOpenNotes which reads from runtime
      const refreshedSlots = getWorkspaceOpenNotes(workspaceIdForComponents)
      const refreshedMembership = getWorkspaceNoteMembership(workspaceIdForComponents)
      hasKnownNotes =
        refreshedSlots.length > 0 ||
        Boolean(refreshedMembership && refreshedMembership.size > 0)
    }
    const cachedPanelsForWorkspace =
      workspaceSnapshotsRef.current.get(workspaceIdForComponents)?.panels ??
      getLastNonEmptySnapshot(
        workspaceIdForComponents,
        lastNonEmptySnapshotsRef.current,
        workspaceSnapshotsRef.current,
      )
    if (panelSnapshots.length === 0 && hasKnownNotes && cachedPanelsForWorkspace.length > 0) {
      panelSnapshots = cachedPanelsForWorkspace
      emitDebugLog({
        component: "NoteWorkspace",
        action: "panel_snapshot_use_cached_for_payload",
        metadata: {
          workspaceId: workspaceIdForComponents,
          fallbackCount: cachedPanelsForWorkspace.length,
        },
      })
    }
    // FIX: Last resort fallback - generate main panel snapshots from open notes
    // This handles the case where:
    // 1. DataStore wasn't seeded (useCanvasNoteSync skipped during workspace restoration)
    // 2. No cached panels exist (new workspace or cache was cleared)
    // 3. But we have open notes that need to be preserved
    // Without this, workspaces with notes but no DataStore seeding would save with 0 panels,
    // causing notes to disappear when switching back.
    if (panelSnapshots.length === 0 && hasKnownNotes) {
      const openNotesForWorkspace = storedOpenNotesForWorkspace.length > 0
        ? storedOpenNotesForWorkspace
        : workspaceMembership
          ? Array.from(workspaceMembership).map((noteId) => ({ noteId, mainPosition: null }))
          : []
      if (openNotesForWorkspace.length > 0) {
        panelSnapshots = openNotesForWorkspace.map((note) => ({
          noteId: note.noteId,
          panelId: "main",
          type: "main",
          title: null,
          position: note.mainPosition ?? null,
          size: null,
          zIndex: null,
          metadata: null,
          parentId: null,
          branches: null,
          worldPosition: note.mainPosition ?? null,
          worldSize: null,
        }))
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_generated_from_open_notes",
          metadata: {
            workspaceId: workspaceIdForComponents,
            generatedCount: panelSnapshots.length,
            reason: "datastore_and_cache_empty_but_notes_exist",
          },
        })
      }
    }
    const shouldAllowEmptyPanels = !hasKnownNotes && panelSnapshots.length === 0
    updatePanelSnapshotMap(panelSnapshots, "build_payload", { allowEmpty: shouldAllowEmptyPanels })
    // Phase 1 Unification: Read components from runtime ledger first (authoritative source)
    // This ensures component data persists across React unmounts
    const runtimeComponents = listRuntimeComponents(workspaceIdForComponents)
    let components: NoteWorkspaceComponentSnapshot[] = runtimeComponents.map((comp) => ({
      id: comp.componentId,
      type: comp.componentType,
      position: comp.position,
      size: comp.size,
      zIndex: comp.zIndex,
      metadata: comp.metadata,
    }))

    // Phase 4: Get deleted components to exclude from fallback
    const deletedComponents = getDeletedComponents(workspaceIdForComponents)

    // Fallback 1: If runtime ledger is empty, try LayerManager (backward compatibility)
    if (components.length === 0) {
      const lm = getWorkspaceLayerManager(workspaceIdForComponents)
      if (lm && typeof lm.getNodes === "function") {
        const beforeFilterCount = Array.from(lm.getNodes().values()).filter((node: any) => node.type === "component").length
        components = Array.from(lm.getNodes().values())
          .filter((node: any) => node.type === "component")
          // Phase 4: Exclude deleted components from fallback
          .filter((node: any) => !deletedComponents.has(node.id))
          .map((node: any) => ({
            id: node.id,
            type:
              (node as any).metadata?.componentType && typeof (node as any).metadata?.componentType === "string"
                ? (node as any).metadata.componentType
                : typeof node.type === "string"
                  ? node.type
                  : "component",
            position: (node as any).position ?? null,
            size: (node as any).dimensions ?? null,
            zIndex: typeof (node as any).zIndex === "number" ? (node as any).zIndex : null,
            metadata: (node as any).metadata ?? null,
          }))
        if (components.length > 0 || beforeFilterCount > 0) {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "build_payload_component_fallback",
            metadata: {
              workspaceId: workspaceIdForComponents,
              fallbackSource: "layerManager",
              componentCount: components.length,
              beforeFilterCount,
              deletedCount: deletedComponents.size,
            },
          })
        }
      }
    }

    // Fallback 2: If still empty, try cached components (existing Fix 5)
    // This prevents component loss when the workspace is in a transitional state (evicted, cold).
    if (components.length === 0 && workspaceIdForComponents) {
      const cachedComponents = lastComponentsSnapshotRef.current.get(workspaceIdForComponents)
      const snapshotComponents = workspaceSnapshotsRef.current.get(workspaceIdForComponents)?.components
      if (cachedComponents && cachedComponents.length > 0) {
        // Phase 4: Exclude deleted components from fallback
        const beforeFilterCount = cachedComponents.length
        components = cachedComponents.filter((c) => !deletedComponents.has(c.id))
        emitDebugLog({
          component: "NoteWorkspace",
          action: "build_payload_component_fallback",
          metadata: {
            workspaceId: workspaceIdForComponents,
            fallbackSource: "lastComponentsSnapshotRef",
            componentCount: components.length,
            beforeFilterCount,
            deletedCount: deletedComponents.size,
          },
        })
      } else if (snapshotComponents && snapshotComponents.length > 0) {
        // Phase 4: Exclude deleted components from fallback
        const beforeFilterCount = snapshotComponents.length
        components = snapshotComponents.filter((c) => !deletedComponents.has(c.id))
        emitDebugLog({
          component: "NoteWorkspace",
          action: "build_payload_component_fallback",
          metadata: {
            workspaceId: workspaceIdForComponents,
            fallbackSource: "workspaceSnapshotsRef",
            componentCount: components.length,
            beforeFilterCount,
            deletedCount: deletedComponents.size,
          },
        })
      }
    }

    // Log component source for debugging
    if (components.length > 0) {
      emitDebugLog({
        component: "NoteWorkspace",
        action: "build_payload_components",
        metadata: {
          workspaceId: workspaceIdForComponents,
          componentCount: components.length,
          runtimeLedgerCount: runtimeComponents.length,
          source: runtimeComponents.length > 0 ? "runtime_ledger" : "fallback",
        },
      })
    }

    let workspaceOpenNotes = getWorkspaceOpenNotes(workspaceIdForComponents)
    // FIX: In live-state mode, runtime is the authoritative source of truth for open notes.
    // Don't infer from stale membership - that would restore deleted notes.
    // Only infer from membership when NOT in live-state mode (legacy fallback).
    if (workspaceOpenNotes.length === 0 && workspaceMembership && workspaceMembership.size > 0) {
      if (!liveStateEnabled) {
        const inferredSlots = Array.from(workspaceMembership).map((noteId) => ({
          noteId,
          mainPosition: resolveMainPanelPosition(noteId),
        }))
        workspaceOpenNotes = commitWorkspaceOpenNotes(workspaceIdForComponents, inferredSlots, {
          updateCache: false,
          callSite: "buildPayload_inferred",
        })
      } else {
        // Log that we skipped inference in live-state mode
        emitDebugLog({
          component: "NoteWorkspace",
          action: "build_payload_inferred_skipped_live_state",
          metadata: {
            workspaceId: workspaceIdForComponents,
            membershipSize: workspaceMembership.size,
            membershipNoteIds: Array.from(workspaceMembership),
            reason: "runtime_is_authoritative_in_live_state",
          },
        })
      }
    }
    // FIX: Validate activeNoteId exists in openNotes before persisting.
    // This prevents persisting a stale activeNoteId when a note has been closed
    // but the React state hasn't updated yet (e.g., due to effect timing).
    // This is a safety net - the primary fix clears activeNoteId when closing notes.
    const openNoteIds = new Set(workspaceOpenNotes.map(n => n.noteId))
    const validatedActiveNoteId = activeNoteId && openNoteIds.has(activeNoteId)
      ? activeNoteId
      : (workspaceOpenNotes[0]?.noteId ?? null)

    // Log if we corrected a stale activeNoteId
    if (activeNoteId && validatedActiveNoteId !== activeNoteId) {
      emitDebugLog({
        component: "NoteWorkspace",
        action: "build_payload_corrected_stale_active_note",
        metadata: {
          workspaceId: workspaceIdForComponents,
          staleActiveNoteId: activeNoteId,
          correctedActiveNoteId: validatedActiveNoteId,
          openNoteCount: workspaceOpenNotes.length,
          reason: "active_note_not_in_open_notes",
        },
      })
    }

    const payload: NoteWorkspacePayload = {
      schemaVersion: "1.1.0",
      openNotes: workspaceOpenNotes.map((note) => {
        const snapshot = getPanelSnapshot(note.noteId)
        return {
          noteId: note.noteId,
          position: resolveMainPanelPosition(note.noteId) ?? null,
          size: snapshot?.size ?? null,
          zIndex: snapshot?.zIndex ?? null,
          isPinned: snapshot?.isPinned ?? false,
        }
      }),
      activeNoteId: validatedActiveNoteId,
      camera: cameraTransform,
      panels: panelSnapshots,
      components,
    }
    if (v2Enabled && currentWorkspaceId) {
      cacheWorkspaceSnapshot({
        workspaceId: currentWorkspaceId,
        panels: panelSnapshots,
        components,
        openNotes: payload.openNotes.map((entry) => ({
          noteId: entry.noteId,
          mainPosition: entry.position ?? null,
        })),
        camera: cameraTransform,
        activeNoteId: validatedActiveNoteId,
      })
      lastPreviewedSnapshotRef.current.delete(currentWorkspaceId)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "snapshot_cached_from_payload",
        metadata: {
          workspaceId: currentWorkspaceId,
          panelCount: panelSnapshots.length,
          componentCount: components?.length ?? 0,
          openCount: payload.openNotes.length,
        },
      })
    }
    return payload
  }, [
    activeNoteId,
    currentWorkspaceId,
    canvasState?.translateX,
    canvasState?.translateY,
    canvasState?.zoom,
    collectPanelSnapshotsFromDataStore,
    commitWorkspaceOpenNotes,
    getPanelSnapshot,
    getWorkspaceNoteMembership,
    getWorkspaceOpenNotes,
    pruneWorkspaceEntries,
    setWorkspaceNoteMembership,
    openNotes,
    resolveMainPanelPosition,
    layerContext?.transforms.notes?.x,
    layerContext?.transforms.notes?.y,
    layerContext?.transforms.notes?.scale,
    getAllPanelSnapshots,
    panelSnapshotVersion,
    updatePanelSnapshotMap,
    v2Enabled,
    emitDebugLog,
    liveStateEnabled,
    cacheWorkspaceSnapshot,
    lastCameraRef,
    snapshotOwnerWorkspaceIdRef,
    currentWorkspaceIdRef,
    workspaceSnapshotsRef,
    lastNonEmptySnapshotsRef,
    lastComponentsSnapshotRef,
    lastPreviewedSnapshotRef,
  ])

  // ---------------------------------------------------------------------------
  // persistWorkspaceById
  // ---------------------------------------------------------------------------
  const persistWorkspaceById = useCallback(
    async (
      targetWorkspaceId: string,
      reason: string,
      options?: { skipReadinessCheck?: boolean; isBackground?: boolean }
    ): Promise<boolean> => {
      if (!targetWorkspaceId || !adapterRef.current) {
        return false
      }

      const isActiveWorkspace = targetWorkspaceId === currentWorkspaceId
      const isBackground = options?.isBackground ?? !isActiveWorkspace
      const saveStart = Date.now()

      // Get open notes from runtime to check if workspace has notes
      const workspaceOpenNotes = getWorkspaceOpenNotes(targetWorkspaceId)

      emitDebugLog({
        component: "NoteWorkspace",
        action: "persist_by_id_start",
        metadata: {
          workspaceId: targetWorkspaceId,
          reason,
          isActiveWorkspace,
          isBackground,
          openCount: workspaceOpenNotes.length,
          skipReadinessCheck: options?.skipReadinessCheck ?? false,
        },
      })

      // Check cooldown period for this workspace
      const skipUntil = skipSavesUntilRef.current.get(targetWorkspaceId) ?? 0
      if (Date.now() < skipUntil) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "persist_by_id_skip_cooldown",
          metadata: { workspaceId: targetWorkspaceId, reason, skipUntil },
        })
        return false
      }

      // Check if save is in flight for this workspace
      if (saveInFlightRef.current.get(targetWorkspaceId)) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "persist_by_id_skip_in_flight",
          metadata: { workspaceId: targetWorkspaceId, reason },
        })
        return false
      }

      // Skip if hydrating or replaying
      if (isHydratingRef.current || replayingWorkspaceRef.current > 0) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "persist_by_id_skip_busy",
          metadata: {
            workspaceId: targetWorkspaceId,
            reason,
            hydrating: isHydratingRef.current,
            replaying: replayingWorkspaceRef.current > 0,
          },
        })
        return false
      }

      saveInFlightRef.current.set(targetWorkspaceId, true)

      try {
        // Wait for panel snapshot readiness unless skipped
        if (!options?.skipReadinessCheck) {
          const ready = await waitForPanelSnapshotReadiness(
            `persist_by_id_${reason}`,
            800,
            targetWorkspaceId
          )
          if (!ready) {
            emitDebugLog({
              component: "NoteWorkspace",
              action: "persist_by_id_skip_not_ready",
              metadata: { workspaceId: targetWorkspaceId, reason },
            })
            saveInFlightRef.current.set(targetWorkspaceId, false)
            return false
          }
        }

        let payload: NoteWorkspacePayload

        if (isActiveWorkspace) {
          // For active workspace, use buildPayload() which handles caching correctly
          payload = buildPayload()
          emitDebugLog({
            component: "NoteWorkspace",
            action: "persist_by_id_used_build_payload",
            metadata: {
              workspaceId: targetWorkspaceId,
              panelCount: payload.panels.length,
              openCount: payload.openNotes.length,
            },
          })
        } else {
          // For background workspace, we need to ensure the snapshot is properly cached
          // First, set membership from observed notes in runtime
          if (workspaceOpenNotes.length > 0) {
            const membershipNoteIds = new Set(workspaceOpenNotes.map((n) => n.noteId))
            setWorkspaceNoteMembership(targetWorkspaceId, membershipNoteIds)
            emitDebugLog({
              component: "NoteWorkspace",
              action: "persist_by_id_set_membership",
              metadata: {
                workspaceId: targetWorkspaceId,
                membershipSize: membershipNoteIds.size,
              },
            })
          }

          // Capture the snapshot to update the cache
          await captureCurrentWorkspaceSnapshot(targetWorkspaceId, {
            readinessReason: `persist_by_id_capture_${reason}`,
            readinessMaxWaitMs: options?.skipReadinessCheck ? 0 : 500,
          })

          // Now read the freshly cached snapshot
          const snapshot = getWorkspaceSnapshot(targetWorkspaceId)
          if (!snapshot) {
            emitDebugLog({
              component: "NoteWorkspace",
              action: "persist_by_id_no_snapshot",
              metadata: { workspaceId: targetWorkspaceId, reason },
            })
            saveInFlightRef.current.set(targetWorkspaceId, false)
            return false
          }

          // Check if snapshot is empty but runtime has notes (cache wasn't updated properly)
          if (snapshot.panels.length === 0 && workspaceOpenNotes.length > 0) {
            emitDebugLog({
              component: "NoteWorkspace",
              action: "persist_by_id_snapshot_empty_but_has_notes",
              metadata: {
                workspaceId: targetWorkspaceId,
                reason,
                snapshotPanels: snapshot.panels.length,
                runtimeNotes: workspaceOpenNotes.length,
              },
            })
            // Don't save empty data when runtime has notes - this would cause data loss
            saveInFlightRef.current.set(targetWorkspaceId, false)
            return false
          }

          payload = buildPayloadFromSnapshot(targetWorkspaceId, snapshot)
          emitDebugLog({
            component: "NoteWorkspace",
            action: "persist_by_id_used_snapshot",
            metadata: {
              workspaceId: targetWorkspaceId,
              panelCount: payload.panels.length,
              openCount: payload.openNotes.length,
            },
          })
        }

        // Compare hash to check for changes
        const payloadHash = serializeWorkspacePayload(payload)
        const previousHash = lastSavedPayloadHashRef.current.get(targetWorkspaceId)

        if (previousHash === payloadHash) {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "persist_by_id_skip_no_changes",
            metadata: {
              workspaceId: targetWorkspaceId,
              reason,
              panelCount: payload.panels.length,
              openCount: payload.openNotes.length,
              durationMs: Date.now() - saveStart,
            },
          })
          saveInFlightRef.current.set(targetWorkspaceId, false)
          // Clear dirty flag since no changes needed
          workspaceDirtyRef.current.delete(targetWorkspaceId)
          return true // No changes needed, but not a failure
        }

        // Perform the save
        const revision = workspaceRevisionRef.current.get(targetWorkspaceId) ?? ""
        const updated = await adapterRef.current.saveWorkspace({
          id: targetWorkspaceId,
          payload,
          revision,
        })

        // Update tracking refs
        workspaceRevisionRef.current.set(targetWorkspaceId, updated.revision ?? null)
        lastSavedPayloadHashRef.current.set(targetWorkspaceId, payloadHash)

        emitDebugLog({
          component: "NoteWorkspace",
          action: "persist_by_id_success",
          metadata: {
            workspaceId: targetWorkspaceId,
            reason,
            isBackground,
            panelCount: payload.panels.length,
            openCount: payload.openNotes.length,
            componentCount: payload.components?.length ?? 0,
            durationMs: Date.now() - saveStart,
          },
        })

        // Update workspace list if this is the active workspace
        if (isActiveWorkspace) {
          setWorkspaces((prev) =>
            prev.map((workspace) =>
              workspace.id === updated.id
                ? {
                    ...workspace,
                    revision: updated.revision,
                    updatedAt: updated.updatedAt,
                    noteCount: updated.noteCount,
                  }
                : workspace
            )
          )
          setStatusHelperText(formatSyncedLabel(updated.updatedAt))
        }

        // Clear dirty flag and in-flight status on success
        workspaceDirtyRef.current.delete(targetWorkspaceId)
        saveInFlightRef.current.set(targetWorkspaceId, false)
        return true
      } catch (error) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "persist_by_id_error",
          metadata: {
            workspaceId: targetWorkspaceId,
            reason,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - saveStart,
          },
        })
        console.warn("[NoteWorkspace] persistWorkspaceById failed", error)
        // Set cooldown for this workspace only
        skipSavesUntilRef.current.set(targetWorkspaceId, Date.now() + 1000)
        saveInFlightRef.current.set(targetWorkspaceId, false)
        return false
      }
    },
    [
      adapterRef,
      buildPayload,
      buildPayloadFromSnapshot,
      captureCurrentWorkspaceSnapshot,
      currentWorkspaceId,
      emitDebugLog,
      getWorkspaceOpenNotes,
      getWorkspaceSnapshot,
      setWorkspaceNoteMembership,
      setWorkspaces,
      setStatusHelperText,
      waitForPanelSnapshotReadiness,
      isHydratingRef,
      lastSavedPayloadHashRef,
      replayingWorkspaceRef,
      saveInFlightRef,
      skipSavesUntilRef,
      workspaceDirtyRef,
      workspaceRevisionRef,
    ]
  )

  // Keep persistWorkspaceByIdRef updated with the latest version
  persistWorkspaceByIdRef.current = persistWorkspaceById

  // ---------------------------------------------------------------------------
  // persistWorkspaceNow
  // ---------------------------------------------------------------------------
  const persistWorkspaceNow = useCallback(async () => {
    // Early bail if no workspace
    if (!featureEnabled || !currentWorkspaceSummary || isHydratingRef.current || replayingWorkspaceRef.current > 0) {
      emitDebugLog({
        component: "NoteWorkspace",
        action: "save_skipped_workspace_busy",
        metadata: {
          workspaceId: currentWorkspaceSummary?.id,
          reason: replayingWorkspaceRef.current > 0 ? "replaying" : "hydrating",
        },
      })
      return
    }
    if (!adapterRef.current) return

    const workspaceId = currentWorkspaceSummary.id
    const now = Date.now()

    // Check cooldown for this workspace
    const skipUntil = skipSavesUntilRef.current.get(workspaceId) ?? 0
    if (now < skipUntil) {
      return
    }

    // Check if save already in flight for this workspace
    if (saveInFlightRef.current.get(workspaceId)) {
      return
    }

    saveInFlightRef.current.set(workspaceId, true)

    const saveStart = Date.now()
    const reason = lastSaveReasonRef.current
    const workspaceOpenNotes = getWorkspaceOpenNotes(workspaceId)
    emitDebugLog({
      component: "NoteWorkspace",
      action: "save_attempt",
      metadata: {
        workspaceId,
        reason,
        timestampMs: saveStart,
        openCount: workspaceOpenNotes.length,
      },
    })
    try {
      const ready = await waitForPanelSnapshotReadiness("persist_workspace", 800, workspaceId)
      if (!ready) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_skip_pending_snapshot",
          metadata: {
            workspaceId,
            reason,
          },
        })
        saveInFlightRef.current.set(workspaceId, false)
        return
      }
      const payload = buildPayload()
      const payloadHash = serializeWorkspacePayload(payload)
      const previousHash = lastSavedPayloadHashRef.current.get(workspaceId)
      if (previousHash === payloadHash) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_skip_no_changes",
          metadata: {
            workspaceId,
            panelCount: payload.panels.length,
            openCount: payload.openNotes.length,
            durationMs: Date.now() - saveStart,
            reason,
          },
        })
        saveInFlightRef.current.set(workspaceId, false)
        workspaceDirtyRef.current.delete(workspaceId)
        return
      }
      const updated = await adapterRef.current.saveWorkspace({
        id: workspaceId,
        payload,
        revision: currentWorkspaceSummary.revision,
      })
      workspaceRevisionRef.current.set(workspaceId, updated.revision ?? null)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "save_success",
        metadata: {
          workspaceId,
          panelCount: payload.panels.length,
          openCount: payload.openNotes.length,
          durationMs: Date.now() - saveStart,
          reason,
        },
      })
      workspaceDirtyRef.current.delete(workspaceId)
      saveInFlightRef.current.set(workspaceId, false)
      lastSavedPayloadHashRef.current.set(workspaceId, payloadHash)
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === updated.id
            ? {
                ...workspace,
                revision: updated.revision,
                updatedAt: updated.updatedAt,
                noteCount: updated.noteCount,
              }
            : workspace,
        ),
      )
      setStatusHelperText(formatSyncedLabel(updated.updatedAt))
    } catch (error) {
      console.warn("[NoteWorkspace] save failed", error)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_error",
          metadata: {
            workspaceId,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - saveStart,
            reason,
          },
        })
        skipSavesUntilRef.current.set(workspaceId, Date.now() + 1000)
        saveInFlightRef.current.set(workspaceId, false)
        return
    }
  }, [
    adapterRef,
    buildPayload,
    currentWorkspaceSummary,
    emitDebugLog,
    featureEnabled,
    getWorkspaceOpenNotes,
    isHydratingRef,
    lastSavedPayloadHashRef,
    lastSaveReasonRef,
    replayingWorkspaceRef,
    saveInFlightRef,
    setStatusHelperText,
    setWorkspaces,
    skipSavesUntilRef,
    waitForPanelSnapshotReadiness,
    workspaceDirtyRef,
    workspaceRevisionRef,
  ])

  // ---------------------------------------------------------------------------
  // Snapshot state subscription effect
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!featureEnabled || !v2Enabled) return
    const unsubscribe = subscribeToWorkspaceSnapshotState((event) => {
      if (event.type === "panel_pending") {
        lastPendingTimestampRef.current.set(event.workspaceId, Date.now())
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_pending",
          metadata: {
            workspaceId: event.workspaceId,
            noteId: event.noteId,
            panelId: event.panelId,
            pendingCount: event.pendingCount,
            timestampMs: event.timestamp,
          },
        })
      } else if (event.type === "panel_ready") {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_ready",
          metadata: {
            workspaceId: event.workspaceId,
            noteId: event.noteId,
            panelId: event.panelId,
            pendingCount: event.pendingCount,
            timestampMs: event.timestamp,
          },
        })
        if (
          event.workspaceId === currentWorkspaceId &&
          !isHydratingRef.current &&
          replayingWorkspaceRef.current === 0
        ) {
          void (async () => {
            await captureCurrentWorkspaceSnapshot(undefined, { readinessReason: "panel_ready_capture" })
            lastSaveReasonRef.current = "panel_ready_auto_save"
            await persistWorkspaceNow()
          })()
        }
      } else if (event.type === "component_pending") {
        lastPendingTimestampRef.current.set(event.workspaceId, Date.now())
        emitDebugLog({
          component: "NoteWorkspace",
          action: "component_pending",
          metadata: {
            workspaceId: event.workspaceId,
            componentId: event.componentId,
            pendingCount: event.pendingCount,
            timestampMs: event.timestamp,
          },
        })
      } else if (event.type === "component_ready") {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "component_ready",
          metadata: {
            workspaceId: event.workspaceId,
            componentId: event.componentId,
            pendingCount: event.pendingCount,
            timestampMs: event.timestamp,
          },
        })
        if (
          event.workspaceId === currentWorkspaceId &&
          !isHydratingRef.current &&
          replayingWorkspaceRef.current === 0
        ) {
          void (async () => {
            await captureCurrentWorkspaceSnapshot(undefined, { readinessReason: "component_ready_capture" })
            lastSaveReasonRef.current = "component_ready_auto_save"
            await persistWorkspaceNow()
          })()
        }
      }
    })
    return unsubscribe
  }, [
    captureCurrentWorkspaceSnapshot,
    currentWorkspaceId,
    emitDebugLog,
    featureEnabled,
    isHydratingRef,
    lastPendingTimestampRef,
    lastSaveReasonRef,
    persistWorkspaceNow,
    replayingWorkspaceRef,
    v2Enabled,
  ])

  // ---------------------------------------------------------------------------
  // scheduleSave
  // ---------------------------------------------------------------------------
  const scheduleSave = useCallback(
    (options?: { immediate?: boolean; reason?: string }) => {
      if (!featureEnabled || !currentWorkspaceSummary || isHydratingRef.current) {
        return
      }
      const { immediate = false, reason = "unspecified" } = options ?? {}
      if (!adapterRef.current) return
      const workspaceId = currentWorkspaceSummary.id

      // Clear any existing timeout for this workspace
      const existingTimeout = saveTimeoutRef.current.get(workspaceId)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
        saveTimeoutRef.current.delete(workspaceId)
      }

      // Mark workspace as dirty
      if (!workspaceDirtyRef.current.has(workspaceId)) {
        workspaceDirtyRef.current.set(workspaceId, Date.now())
      }

      lastSaveReasonRef.current = reason
      emitDebugLog({
        component: "NoteWorkspace",
        action: "save_schedule",
        metadata: {
          workspaceId,
          immediate,
          reason,
          dirtyAt: workspaceDirtyRef.current.get(workspaceId),
        },
      })
      if (immediate) {
        void persistWorkspaceById(workspaceId, reason)
        return
      }
      const timeout = setTimeout(() => {
        saveTimeoutRef.current.delete(workspaceId)
        void persistWorkspaceById(workspaceId, reason)
      }, 2500)
      saveTimeoutRef.current.set(workspaceId, timeout)
    },
    [
      adapterRef,
      currentWorkspaceSummary,
      emitDebugLog,
      featureEnabled,
      isHydratingRef,
      lastSaveReasonRef,
      persistWorkspaceById,
      saveTimeoutRef,
      workspaceDirtyRef,
    ],
  )

  // ---------------------------------------------------------------------------
  // flushPendingSave
  // ---------------------------------------------------------------------------
  const flushPendingSave = useCallback(
    (reason = "manual_flush") => {
      // Flush ALL pending dirty workspaces, not just current
      // This is important for beforeunload/visibility_hidden scenarios
      const pendingWorkspaceIds = Array.from(saveTimeoutRef.current.keys())

      emitDebugLog({
        component: "NoteWorkspace",
        action: "save_flush_all",
        metadata: {
          reason,
          pendingCount: pendingWorkspaceIds.length,
          pendingWorkspaceIds,
          currentWorkspaceId: currentWorkspaceSummaryId,
        },
      })

      // Clear and save all pending workspaces
      for (const workspaceId of pendingWorkspaceIds) {
        const existingTimeout = saveTimeoutRef.current.get(workspaceId)
        if (existingTimeout) {
          clearTimeout(existingTimeout)
          saveTimeoutRef.current.delete(workspaceId)
        }
        void persistWorkspaceById(workspaceId, reason)
      }

      // Also save current workspace if dirty but no timeout was pending
      if (
        currentWorkspaceSummaryId &&
        workspaceDirtyRef.current.has(currentWorkspaceSummaryId) &&
        !pendingWorkspaceIds.includes(currentWorkspaceSummaryId)
      ) {
        void persistWorkspaceById(currentWorkspaceSummaryId, reason)
      }
    },
    [
      currentWorkspaceSummaryId,
      emitDebugLog,
      persistWorkspaceById,
      saveTimeoutRef,
      workspaceDirtyRef,
    ],
  )

  // ---------------------------------------------------------------------------
  // handleEntryChange
  // ---------------------------------------------------------------------------
  const handleEntryChange = useCallback(
    (newEntryId: string | null) => {
      const previousEntryId = previousEntryIdRef.current
      if (previousEntryId === newEntryId) return

      emitDebugLog({
        component: "NoteWorkspace",
        action: "entry_switch",
        metadata: {
          previousEntryId,
          newEntryId,
          dirtyWorkspaceCount: workspaceDirtyRef.current.size,
        },
      })

      // Flush all dirty workspaces from previous entry before switching
      if (previousEntryId && workspaceDirtyRef.current.size > 0) {
        flushPendingSave("entry_switch")
      }

      // Update entry state
      previousEntryIdRef.current = newEntryId
      setCurrentEntryIdState(newEntryId)
      setActiveEntryContext(newEntryId)
    },
    [
      emitDebugLog,
      flushPendingSave,
      previousEntryIdRef,
      setCurrentEntryIdState,
      workspaceDirtyRef,
    ],
  )

  // ---------------------------------------------------------------------------
  // Entry context subscription effect
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!featureEnabled) return

    const unsubscribe = subscribeToActiveEntryContext((entryId: string | null) => {
      if (entryId !== currentEntryId) {
        handleEntryChange(entryId)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [featureEnabled, currentEntryId, handleEntryChange])

  return {
    buildPayload,
    persistWorkspaceById,
    persistWorkspaceNow,
    scheduleSave,
    flushPendingSave,
    handleEntryChange,
  }
}
