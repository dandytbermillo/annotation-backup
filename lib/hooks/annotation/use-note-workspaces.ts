import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect, type Dispatch, type SetStateAction } from "react"

import type { LayerContextValue } from "@/components/canvas/layer-provider"
import {
  useNoteWorkspaceRuntimeManager,
  type NoteWorkspaceDebugLogger,
} from "@/lib/hooks/annotation/use-note-workspace-runtime-manager"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
import { getLayerManager } from "@/lib/canvas/layer-manager"
import { getWorkspaceLayerManager } from "@/lib/workspace/workspace-layer-manager-registry"
import { DataStore } from "@/lib/data-store"
import { getWorkspaceStore } from "@/lib/workspace/workspace-store-registry"
import {
  getWorkspaceRuntime,
  getRuntimeOpenNotes,
  setRuntimeOpenNotes,
  getRuntimeMembership,
  setRuntimeMembership,
  setRuntimeNoteOwner,
  clearRuntimeNoteOwner,
  hasWorkspaceRuntime,
  listWorkspaceRuntimeIds,
  removeWorkspaceRuntime,
  // Phase 2: Visibility management
  setRuntimeVisible,
  isRuntimeVisible,
  listHotRuntimes,
  notifyRuntimeChanges,
  // Phase 3: Pre-eviction callbacks
  registerPreEvictionCallback,
  unregisterPreEvictionCallback,
  getCapturedEvictionState,
  type PreEvictionCallback,
  // Phase 1: Component registration
  getRegisteredComponentCount,
  // Phase 1 Unification: Runtime component ledger
  listRuntimeComponents,
  populateRuntimeComponents,
  getRuntimeComponentCount,
  // Phase 4: Deleted component tracking
  getDeletedComponents,
  clearDeletedComponents,
  // Phase 5: Entry-workspace tracking
  setWorkspaceEntry,
  markWorkspaceAsDefault,
} from "@/lib/workspace/runtime-manager"
import { NoteWorkspaceAdapter, type NoteWorkspaceSummary } from "@/lib/adapters/note-workspace-adapter"
import {
  isNoteWorkspaceEnabled,
  isNoteWorkspaceLiveStateEnabled,
  isNoteWorkspaceV2Enabled,
} from "@/lib/flags/note"
import type { CanvasState } from "@/lib/hooks/annotation/use-workspace-canvas-state"
import type { WorkspacePanelSnapshot } from "@/lib/hooks/annotation/use-workspace-panel-positions"
import type {
  NoteWorkspacePayload,
  NoteWorkspacePanelSnapshot,
  NoteWorkspaceComponentSnapshot,
} from "@/lib/types/note-workspace"
import { SHARED_WORKSPACE_ID, type NoteWorkspace, type NoteWorkspaceSlot } from "@/lib/workspace/types"
import {
  cacheWorkspaceSnapshot,
  getPendingPanelCount,
  getWorkspaceSnapshot,
  setNoteWorkspaceOwner,
  clearNoteWorkspaceOwner,
  waitForWorkspaceSnapshotReady,
  subscribeToWorkspaceSnapshotState,
  setActiveWorkspaceContext,
  getActiveWorkspaceContext,
  subscribeToWorkspaceListRefresh,
  type NoteWorkspaceSnapshot,
} from "@/lib/note-workspaces/state"
import { debugLog } from "@/lib/utils/debug-logger"
import {
  getActiveEntryContext,
  subscribeToActiveEntryContext,
  setActiveEntryContext,
} from "@/lib/entry"
import {
  DEFAULT_CAMERA,
  NOTE_WORKSPACE_DEBUG_ENABLED,
  DESKTOP_RUNTIME_CAP,
  CAPTURE_DEFER_DELAY_MS,
  type WorkspaceSnapshotCache,
  detectRuntimeCapacity,
  serializeWorkspacePayload,
  serializePanelSnapshots,
  ensureWorkspaceSnapshotCache,
  getLastNonEmptySnapshot,
  existingOpenSnapshot,
  now,
  formatSyncedLabel,
  normalizeWorkspaceSlots,
  areWorkspaceSlotsEqual,
  buildPanelSnapshotFromRecord,
  mergePanelSnapshots,
  mergeComponentSnapshots,
} from "./workspace/workspace-utils"
import { useWorkspaceRefs } from "./workspace/workspace-refs"
import { useWorkspaceMembership } from "./workspace/use-workspace-membership"
import { useWorkspacePanelSnapshots } from "./workspace/use-workspace-panel-snapshots"
import { useWorkspaceSnapshot } from "./workspace/use-workspace-snapshot"
import { useWorkspacePersistence } from "./workspace/use-workspace-persistence"
import { useWorkspaceHydration } from "./workspace/use-workspace-hydration"
import { useWorkspaceCrud } from "./workspace/use-workspace-crud"
import { useWorkspaceSelection } from "./workspace/use-workspace-selection"
import type { UseNoteWorkspaceOptions, UseNoteWorkspaceResult } from "./workspace/workspace-types"

export function useNoteWorkspaces({
  openNotes,
  openNotesWorkspaceId = null,
  activeNoteId,
  setActiveNoteId,
  resolveMainPanelPosition,
  openWorkspaceNote,
  closeWorkspaceNote,
  layerContext,
  isWorkspaceReady,
  getPanelSnapshot,
  panelSnapshotVersion,
  canvasState,
  setCanvasState,
  onUnavailable,
  debugLog: debugLogger,
  sharedWorkspace,
}: UseNoteWorkspaceOptions): UseNoteWorkspaceResult {
  const flagEnabled = isNoteWorkspaceEnabled()
  const v2Enabled = isNoteWorkspaceV2Enabled()
  const liveStateEnabled = isNoteWorkspaceLiveStateEnabled()

  // Get initial entry ID for refs initialization
  const initialEntryId = getActiveEntryContext()

  // Initialize all workspace refs via centralized hook
  const {
    adapterRef,
    panelSnapshotsRef,
    workspaceSnapshotsRef,
    workspaceOpenNotesRef,
    workspaceNoteMembershipRef,
    lastNonEmptySnapshotsRef,
    snapshotOwnerWorkspaceIdRef,
    currentWorkspaceIdRef,
    lastPreviewedSnapshotRef,
    workspaceRevisionRef,
    workspaceStoresRef,
    lastComponentsSnapshotRef,
    lastPendingTimestampRef,
    replayingWorkspaceRef,
    lastSavedPayloadHashRef,
    lastPanelSnapshotHashRef,
    ownedNotesRef,
    inferredWorkspaceNotesRef,
    previousVisibleWorkspaceRef,
    lastSaveReasonRef,
    saveInFlightRef,
    skipSavesUntilRef,
    workspaceDirtyRef,
    saveTimeoutRef,
    isHydratingRef,
    lastCameraRef,
    previousEntryIdRef,
    unavailableNoticeShownRef,
    lastHydratedWorkspaceIdRef,
    captureRetryAttemptsRef,
    deferredCachedCaptureCountRef,
    persistWorkspaceByIdRef,
    captureSnapshotRef,
    emitDebugLogRef,
    ensureRuntimePreparedRef,
    pruneWorkspaceEntriesRef,
    listedOnceRef,
  } = useWorkspaceRefs(initialEntryId)

  // State declarations
  const [workspaces, setWorkspaces] = useState<NoteWorkspaceSummary[]>([])
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null)
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [statusHelperText, setStatusHelperText] = useState<string | null>(null)
  const [isUnavailable, setIsUnavailable] = useState(false)
  // Entry context state - tracks which entry (item) the user is working in
  const [currentEntryId, setCurrentEntryIdState] = useState<string | null>(() => initialEntryId)
  const featureEnabled = flagEnabled && !isUnavailable
  // Loop breaker constant
  const MAX_DEFERRED_CACHED_CAPTURES = 3
  const [snapshotRevision, setSnapshotRevision] = useState(0)
  const bumpSnapshotRevision = useCallback(() => {
    setSnapshotRevision((prev) => prev + 1)
  }, [])
  const runtimeCapacity = useMemo(
    () => (liveStateEnabled ? detectRuntimeCapacity() : Number.POSITIVE_INFINITY),
    [liveStateEnabled],
  )

  const currentWorkspaceSummary = useMemo(
    () => workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null,
    [currentWorkspaceId, workspaces],
  )
  const targetWorkspaceId = pendingWorkspaceId ?? currentWorkspaceId
  const currentWorkspaceSummaryId = currentWorkspaceSummary?.id ?? null

  // Phase 5: Mark default workspaces when workspace list changes
  // This ensures default workspaces are marked for eviction protection
  useEffect(() => {
    if (!liveStateEnabled) return

    for (const workspace of workspaces) {
      if (workspace.isDefault) {
        markWorkspaceAsDefault(workspace.id)
      }
    }
  }, [workspaces, liveStateEnabled])

  // Filter workspaces by current entry context
  // Also exclude "Dashboard" workspaces - they are shown via DashboardView, not in dropdown
  const workspacesForCurrentEntry = useMemo(() => {
    // Filter out Dashboard workspaces from the dropdown
    const excludeDashboard = (list: typeof workspaces) =>
      list.filter((ws) => ws.name !== "Dashboard")

    if (!currentEntryId) {
      // No entry selected - return all workspaces (except Dashboard)
      return excludeDashboard(workspaces)
    }
    const filtered = workspaces.filter((ws) => ws.itemId === currentEntryId && ws.name !== "Dashboard")
    // If no workspaces match, fall back to all (better UX than empty list)
    return filtered.length > 0 ? filtered : excludeDashboard(workspaces)
  }, [workspaces, currentEntryId])

  // Create a stable ref-based wrapper for emitDebugLog that forwards to the ref
  // This allows calling emitDebugLog before it's defined, since callbacks capture closures at call-time
  const emitDebugLogViaRef = useCallback(
    (payload: { component: string; action: string; metadata?: Record<string, unknown> }) => {
      emitDebugLogRef.current?.(payload)
    },
    [emitDebugLogRef],
  )

  // Create a stable ref-based wrapper for ensureRuntimePrepared
  // This resolves the circular dependency: useWorkspaceSnapshot needs ensureRuntimePrepared
  // from useNoteWorkspaceRuntimeManager, but the runtime manager needs captureCurrentWorkspaceSnapshot
  // from useWorkspaceSnapshot. By using a ref-forwarding wrapper, useWorkspaceSnapshot can be
  // called before the runtime manager, and the ref is populated afterward.
  const ensureRuntimePreparedViaRef = useCallback(
    async (workspaceId: string, reason: string): Promise<void> => {
      await ensureRuntimePreparedRef.current?.(workspaceId, reason)
    },
    [ensureRuntimePreparedRef],
  )

  // Create a stable ref-based wrapper for pruneWorkspaceEntries
  // This resolves ordering dependency: useWorkspaceSnapshot needs pruneWorkspaceEntries
  // but it's defined after emitDebugLog. By using a ref-forwarding wrapper, useWorkspaceSnapshot
  // can be called earlier, and the ref is populated after pruneWorkspaceEntries is defined.
  const pruneWorkspaceEntriesViaRef = useCallback(
    (workspaceId: string | null | undefined, observedNoteIds: Set<string>, reason: string): boolean => {
      return pruneWorkspaceEntriesRef.current?.(workspaceId, observedNoteIds, reason) ?? false
    },
    [pruneWorkspaceEntriesRef],
  )

  // Use extracted membership hook
  const {
    setWorkspaceNoteMembership,
    getWorkspaceNoteMembership,
    commitWorkspaceOpenNotes,
    getWorkspaceOpenNotes,
  } = useWorkspaceMembership({
    refs: {
      adapterRef,
      panelSnapshotsRef,
      workspaceSnapshotsRef,
      lastNonEmptySnapshotsRef,
      lastPreviewedSnapshotRef,
      lastComponentsSnapshotRef,
      workspaceOpenNotesRef,
      workspaceNoteMembershipRef,
      ownedNotesRef,
      inferredWorkspaceNotesRef,
      snapshotOwnerWorkspaceIdRef,
      currentWorkspaceIdRef,
      workspaceRevisionRef,
      workspaceStoresRef,
      previousVisibleWorkspaceRef,
      lastHydratedWorkspaceIdRef,
      lastPendingTimestampRef,
      lastSavedPayloadHashRef,
      lastPanelSnapshotHashRef,
      lastSaveReasonRef,
      saveInFlightRef,
      skipSavesUntilRef,
      workspaceDirtyRef,
      saveTimeoutRef,
      isHydratingRef,
      replayingWorkspaceRef,
      lastCameraRef,
      previousEntryIdRef,
      unavailableNoticeShownRef,
      listedOnceRef,
      captureRetryAttemptsRef,
      deferredCachedCaptureCountRef,
      persistWorkspaceByIdRef,
      captureSnapshotRef,
      emitDebugLogRef,
      ensureRuntimePreparedRef,
      pruneWorkspaceEntriesRef,
    },
    liveStateEnabled,
    v2Enabled,
    emitDebugLog: emitDebugLogViaRef,
    openNotes,
    openNotesWorkspaceId: openNotesWorkspaceId ?? null,
  })

  // NOTE: Membership functions extracted to use-workspace-membership.ts

  // Use extracted panel snapshots hook
  const {
    filterPanelsForWorkspace,
    getRuntimeDataStore,
    getWorkspaceDataStore,
    collectPanelSnapshotsFromDataStore,
    getAllPanelSnapshots,
    updatePanelSnapshotMap,
    waitForPanelSnapshotReadiness,
  } = useWorkspacePanelSnapshots({
    refs: {
      adapterRef,
      panelSnapshotsRef,
      workspaceSnapshotsRef,
      lastNonEmptySnapshotsRef,
      lastPreviewedSnapshotRef,
      lastComponentsSnapshotRef,
      workspaceOpenNotesRef,
      workspaceNoteMembershipRef,
      ownedNotesRef,
      inferredWorkspaceNotesRef,
      snapshotOwnerWorkspaceIdRef,
      currentWorkspaceIdRef,
      workspaceRevisionRef,
      workspaceStoresRef,
      previousVisibleWorkspaceRef,
      lastHydratedWorkspaceIdRef,
      lastPendingTimestampRef,
      lastSavedPayloadHashRef,
      lastPanelSnapshotHashRef,
      lastSaveReasonRef,
      saveInFlightRef,
      skipSavesUntilRef,
      workspaceDirtyRef,
      saveTimeoutRef,
      isHydratingRef,
      replayingWorkspaceRef,
      lastCameraRef,
      previousEntryIdRef,
      unavailableNoticeShownRef,
      listedOnceRef,
      captureRetryAttemptsRef,
      deferredCachedCaptureCountRef,
      persistWorkspaceByIdRef,
      captureSnapshotRef,
      emitDebugLogRef,
      ensureRuntimePreparedRef,
      pruneWorkspaceEntriesRef,
    },
    featureEnabled,
    liveStateEnabled,
    v2Enabled,
    emitDebugLog: emitDebugLogViaRef,
    getWorkspaceNoteMembership,
    currentWorkspaceId,
    sharedWorkspace: sharedWorkspace ?? null,
  })

  // Use extracted snapshot management hook
  // Note: Uses ref-forwarding wrappers for ensureRuntimePrepared (circular dependency with runtime manager)
  // and pruneWorkspaceEntries (ordering dependency - defined after emitDebugLog)
  const {
    applyPanelSnapshots,
    captureCurrentWorkspaceSnapshot,
    buildPayloadFromSnapshot,
    rehydratePanelsForNote,
    previewWorkspaceFromSnapshot,
  } = useWorkspaceSnapshot({
    refs: {
      adapterRef,
      panelSnapshotsRef,
      workspaceSnapshotsRef,
      lastNonEmptySnapshotsRef,
      lastPreviewedSnapshotRef,
      lastComponentsSnapshotRef,
      workspaceOpenNotesRef,
      workspaceNoteMembershipRef,
      ownedNotesRef,
      inferredWorkspaceNotesRef,
      snapshotOwnerWorkspaceIdRef,
      currentWorkspaceIdRef,
      workspaceRevisionRef,
      workspaceStoresRef,
      previousVisibleWorkspaceRef,
      lastHydratedWorkspaceIdRef,
      lastPendingTimestampRef,
      lastSavedPayloadHashRef,
      lastPanelSnapshotHashRef,
      lastSaveReasonRef,
      saveInFlightRef,
      skipSavesUntilRef,
      workspaceDirtyRef,
      saveTimeoutRef,
      isHydratingRef,
      replayingWorkspaceRef,
      lastCameraRef,
      previousEntryIdRef,
      unavailableNoticeShownRef,
      listedOnceRef,
      captureRetryAttemptsRef,
      deferredCachedCaptureCountRef,
      persistWorkspaceByIdRef,
      captureSnapshotRef,
      emitDebugLogRef,
      ensureRuntimePreparedRef,
      pruneWorkspaceEntriesRef,
    },
    featureEnabled,
    liveStateEnabled,
    v2Enabled,
    emitDebugLog: emitDebugLogViaRef,
    currentWorkspaceId,
    activeNoteId,
    canvasState,
    layerContext,
    sharedWorkspace: sharedWorkspace ?? null,
    openNotes,
    maxDeferredCachedCaptures: MAX_DEFERRED_CACHED_CAPTURES,
    bumpSnapshotRevision,
    setActiveNoteId,
    setCanvasState: setCanvasState ?? null,
    getWorkspaceDataStore,
    getWorkspaceNoteMembership,
    setWorkspaceNoteMembership,
    commitWorkspaceOpenNotes,
    getWorkspaceOpenNotes,
    filterPanelsForWorkspace,
    collectPanelSnapshotsFromDataStore,
    updatePanelSnapshotMap,
    waitForPanelSnapshotReadiness,
    pruneWorkspaceEntries: pruneWorkspaceEntriesViaRef,
    resolveMainPanelPosition,
    openWorkspaceNote,
    closeWorkspaceNote,
    ensureRuntimePrepared: ensureRuntimePreparedViaRef,
  })

  // NOTE: Panel snapshot helpers extracted to use-workspace-panel-snapshots.ts

  const emitDebugLog = useCallback(
    (payload: Parameters<NonNullable<NoteWorkspaceDebugLogger>>[0]) => {
      if (!debugLogger || !NOTE_WORKSPACE_DEBUG_ENABLED) return
      let workspaceName: string | undefined
      if (payload.metadata && typeof payload.metadata === "object") {
        const workspaceId =
          typeof payload.metadata.workspaceId === "string"
            ? payload.metadata.workspaceId
            : null
        if (workspaceId) {
          const matching = workspaces.find((entry) => entry.id === workspaceId)
          if (matching) {
            workspaceName = matching.name
          }
        }
      } else {
        payload.metadata = {}
      }
      if (payload.metadata && workspaceName) {
        ;(payload.metadata as Record<string, unknown>).workspaceName = workspaceName
      }
      void debugLogger(payload)
    },
    [debugLogger, workspaces],
  )

  // Keep emitDebugLogRef updated with the latest version
  emitDebugLogRef.current = emitDebugLog

  const getProviderOpenNoteIds = useCallback(
    (workspaceId: string | null | undefined): Set<string> => {
      if (!workspaceId) return new Set()
      if (!openNotesWorkspaceId || openNotesWorkspaceId !== workspaceId) return new Set()
      return new Set(
        openNotes
          .map((entry) => entry?.noteId)
          .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
      )
    },
    [openNotes, openNotesWorkspaceId],
  )

  const pruneWorkspaceEntries = useCallback(
    (workspaceId: string | null | undefined, observedNoteIds: Set<string>, reason: string) => {
      if (!v2Enabled || !workspaceId) return false
      // FIX: Use runtime membership as the SOLE source of truth.
      // Previously, this code checked providerMatches and providerNoteIds which could be pointing
      // at a different workspace during transitions. Now we use only the per-workspace runtime ledger.
      const runtimeMembership = getRuntimeMembership(workspaceId)
      const runtimeOpenNotes = getRuntimeOpenNotes(workspaceId)
      const runtimeNoteIds = new Set(runtimeOpenNotes.map(n => n.noteId).filter(Boolean))
      const lastPendingAt = lastPendingTimestampRef.current.get(workspaceId) ?? 0
      if (lastPendingAt > 0 && now() - lastPendingAt < 1500) {
        return false
      }
      // If runtime has no data for this workspace, skip pruning (workspace not hydrated yet)
      if (runtimeNoteIds.size === 0 && (!runtimeMembership || runtimeMembership.size === 0)) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "workspace_prune_skipped_no_runtime",
          metadata: {
            workspaceId,
            reason,
            observedNoteCount: observedNoteIds.size,
            source: "runtime_only",
          },
        })
        return false
      }
      const staleNoteIds = new Set<string>()
      if (runtimeMembership) {
        runtimeMembership.forEach((noteId) => {
          if (!observedNoteIds.has(noteId) && !runtimeNoteIds.has(noteId)) {
            staleNoteIds.add(noteId)
          }
        })
      }
      runtimeOpenNotes.forEach((slot) => {
        if (slot.noteId && !observedNoteIds.has(slot.noteId)) {
          staleNoteIds.add(slot.noteId)
        }
      })
      if (staleNoteIds.size === 0) {
        return false
      }
      const filteredSlots = runtimeOpenNotes.filter((slot) => !staleNoteIds.has(slot.noteId))
      commitWorkspaceOpenNotes(workspaceId, filteredSlots, { updateCache: true, callSite: "evictStaleNotes" })
      const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, workspaceId)
      if (cache.panels.length > 0) {
        cache.panels = cache.panels.filter((panel) => {
          if (!panel.noteId) return true
          return !staleNoteIds.has(panel.noteId)
        })
      }
      if (cache.panels.length === 0) {
        lastNonEmptySnapshotsRef.current.delete(workspaceId)
      }
      staleNoteIds.forEach((noteId) => {
        panelSnapshotsRef.current.delete(noteId)
      })
      emitDebugLog({
        component: "NoteWorkspace",
        action: "workspace_prune_stale_notes",
        metadata: {
          workspaceId,
          reason,
          staleNoteIds: Array.from(staleNoteIds),
          observedNoteCount: observedNoteIds.size,
          runtimeOpenCount: runtimeNoteIds.size,
        },
      })
      return true
    },
    [commitWorkspaceOpenNotes, emitDebugLog, getRuntimeMembership, getRuntimeOpenNotes, v2Enabled],
  )

  // Populate pruneWorkspaceEntriesRef after pruneWorkspaceEntries is defined
  // This resolves the ordering dependency: useWorkspaceSnapshot needed pruneWorkspaceEntries
  // but is called before pruneWorkspaceEntries is defined (due to emitDebugLog dependency)
  pruneWorkspaceEntriesRef.current = pruneWorkspaceEntries



  // Keep captureSnapshotRef updated with the latest version
  captureSnapshotRef.current = captureCurrentWorkspaceSnapshot


  const persistWorkspaceSnapshot = useCallback(
    async (workspaceId: string | null | undefined, reason: string) => {
      if (!workspaceId || !adapterRef.current) return false
      const snapshot = getWorkspaceSnapshot(workspaceId)
      if (!snapshot) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_skip_no_snapshot",
          metadata: { workspaceId, reason },
        })
        return false
      }
      const payload = buildPayloadFromSnapshot(workspaceId, snapshot)
      const payloadHash = serializeWorkspacePayload(payload)
      const previousHash = lastSavedPayloadHashRef.current.get(workspaceId)
      if (previousHash === payloadHash) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_skip_no_changes",
          metadata: { workspaceId, reason },
        })
        return true
      }
      const saveStart = Date.now()
      try {
        const updated = await adapterRef.current.saveWorkspace({
          id: workspaceId,
          payload,
          revision: workspaceRevisionRef.current.get(workspaceId) ?? "",
        })
        workspaceRevisionRef.current.set(workspaceId, updated.revision ?? null)
        lastSavedPayloadHashRef.current.set(workspaceId, payloadHash)

        // Phase 4: Clear deleted component tracking after successful save.
        // Deleted components are now persisted (excluded from payload), so we can
        // clear the tracking to avoid stale entries accumulating.
        clearDeletedComponents(workspaceId)

        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_success",
          metadata: {
            workspaceId,
            reason,
            panelCount: payload.panels.length,
            openCount: payload.openNotes.length,
            durationMs: Date.now() - saveStart,
          },
        })
        return true
      } catch (error) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_error",
          metadata: {
            workspaceId,
            reason,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - saveStart,
          },
        })
        return false
      }
    },
    [adapterRef, buildPayloadFromSnapshot, emitDebugLog],
  )

  const {
    ensureRuntimePrepared,
    updateRuntimeAccess,
    runtimeAccessRef,
  } = useNoteWorkspaceRuntimeManager({
    liveStateEnabled,
    currentWorkspaceId,
    pendingWorkspaceId,
    runtimeCapacity,
    captureSnapshot: captureCurrentWorkspaceSnapshot,
    persistSnapshot: persistWorkspaceSnapshot,
    emitDebugLog,
  })

  // Populate ensureRuntimePreparedRef after the runtime manager is defined
  // This resolves the circular dependency: useWorkspaceSnapshot needed ensureRuntimePrepared
  // but is called before useNoteWorkspaceRuntimeManager
  ensureRuntimePreparedRef.current = ensureRuntimePrepared




  useEffect(() => {
    if (!featureEnabled || !v2Enabled) {
      setActiveWorkspaceContext(null)
      return
    }
    currentWorkspaceIdRef.current = currentWorkspaceId
    // Only set context when we have a valid workspaceId
    // This preserves pending context (e.g., from Dashboard navigation) when mounting with null
    if (currentWorkspaceId) {
      setActiveWorkspaceContext(currentWorkspaceId)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "workspace_active_set",
        metadata: { workspaceId: currentWorkspaceId },
      })
    }
  }, [featureEnabled, v2Enabled, currentWorkspaceId])

  useEffect(() => {
    emitDebugLog({
      component: "NoteWorkspace",
      action: "cleanup_effect_mount",
      metadata: { note: "Cleanup effect mounted" },
    })
    return () => {
      // Only clear the context if this instance "owns" it
      // This prevents clearing context set by DashboardInitializer during navigation
      const currentContext = getActiveWorkspaceContext()
      const ownedWorkspaceId = currentWorkspaceIdRef.current

      emitDebugLog({
        component: "NoteWorkspace",
        action: "cleanup_effect_unmount",
        metadata: {
          currentContext,
          ownedWorkspaceId,
          willClear: currentContext === ownedWorkspaceId,
        },
      })

      // Only clear if this instance owns the current context
      // If context was changed by navigation (DashboardInitializer), don't clear it
      if (currentContext === ownedWorkspaceId) {
        setActiveWorkspaceContext(null)
      }
    }
  }, [])

  useEffect(() => {
    if (!v2Enabled) return
    if (currentWorkspaceId && snapshotOwnerWorkspaceIdRef.current !== currentWorkspaceId) {
      snapshotOwnerWorkspaceIdRef.current = currentWorkspaceId
    }
    return () => {
      if (snapshotOwnerWorkspaceIdRef.current === currentWorkspaceId) {
        snapshotOwnerWorkspaceIdRef.current = null
      }
    }
  }, [v2Enabled, currentWorkspaceId])

  useEffect(() => {
    if (featureEnabled && v2Enabled) {
      return
    }
    if (ownedNotesRef.current.size === 0) {
      return
    }
    ownedNotesRef.current.forEach((_, noteId) => {
      clearNoteWorkspaceOwner(noteId)
    })
    ownedNotesRef.current.clear()
    workspaceNoteMembershipRef.current.clear()
  }, [featureEnabled, v2Enabled])

  useEffect(() => {
    if (!featureEnabled || !v2Enabled) return
    if (!currentWorkspaceId) return
    if (openNotesWorkspaceId !== currentWorkspaceId) return
    if (replayingWorkspaceRef.current > 0 || isHydratingRef.current) return

    // FIX 20: DISABLE provider → runtime sync when live-state is enabled.
    // When live-state mode is active, the per-workspace runtime is the authoritative source of truth.
    // The runtime is populated correctly via:
    //   - hydrateWorkspace() calls commitWorkspaceOpenNotes() from DB data
    //   - openNote() / closeNote() call syncRuntimeOpenState()
    //
    // This provider → runtime sync was causing cross-workspace contamination because:
    // 1. Provider openNotes can be transiently empty or stale during workspace switches
    // 2. When guards fail, wrong/empty data gets committed to the runtime
    // 3. With runtime empty/wrong, canvas falls back to cache which may have other workspace's notes
    //
    // By disabling this sync, the runtime remains uncontaminated by provider state mismatches.
    // The provider (openNotes) is now for UI rendering only; runtime is authoritative for persistence.
    if (liveStateEnabled) {
      // Log that we're skipping this sync (helps with debugging)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "openNotesSync_skipped_live_state",
        metadata: {
          workspaceId: currentWorkspaceId,
          openNotesCount: openNotes.length,
          reason: "live_state_enabled_runtime_is_authoritative",
        },
      })
      return
    }

    // FIX 18: Guard against committing empty openNotes to a hot runtime during workspace switch.
    // When switching workspaces, the provider's openNotes is transiently empty while the runtime
    // still has notes from the previous session. Committing empty here would wipe the runtime's
    // note membership, causing useCanvasNoteSync to remove the main panel.
    // Only skip if: (1) openNotes is empty AND (2) runtime already has notes (hot runtime)
    if (openNotes.length === 0) {
      const runtimeMembership = getRuntimeMembership(currentWorkspaceId)
      if (runtimeMembership && runtimeMembership.size > 0) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "openNotesSync_skip_hot_runtime",
          metadata: {
            workspaceId: currentWorkspaceId,
            openNotesCount: 0,
            runtimeMembershipCount: runtimeMembership.size,
            runtimeNoteIds: Array.from(runtimeMembership),
            reason: "provider_openNotes_transiently_empty_but_runtime_has_notes",
          },
        })
        return
      }
    }

    // DEBUG: Log what we're about to commit and whether it matches expected workspace
    emitDebugLog({
      component: "NoteWorkspace",
      action: "openNotesSync_about_to_commit",
      metadata: {
        currentWorkspaceId,
        openNotesWorkspaceId,
        openNotesCount: openNotes.length,
        openNoteIds: openNotes.map(n => n.noteId),
        workspaceIdMatch: currentWorkspaceId === openNotesWorkspaceId,
      },
    })

    commitWorkspaceOpenNotes(currentWorkspaceId, openNotes, { updateCache: false, callSite: "useEffect_openNotesSync" })
  }, [
    commitWorkspaceOpenNotes,
    emitDebugLog,
    featureEnabled,
    liveStateEnabled,
    v2Enabled,
    currentWorkspaceId,
    openNotes,
    openNotesWorkspaceId,
  ])

  const markUnavailable = useCallback(
    (reason?: string) => {
      if (!flagEnabled) return
      setIsUnavailable(true)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "api_unavailable",
        metadata: { reason: reason ?? null },
      })
      if (!unavailableNoticeShownRef.current) {
        unavailableNoticeShownRef.current = true
        onUnavailable?.()
      }
    },
    [emitDebugLog, flagEnabled, onUnavailable],
  )

  // Construct refs object for extracted hooks
  const workspaceRefsForHooks = useMemo(
    () => ({
      adapterRef,
      panelSnapshotsRef,
      workspaceSnapshotsRef,
      workspaceOpenNotesRef,
      workspaceNoteMembershipRef,
      lastNonEmptySnapshotsRef,
      snapshotOwnerWorkspaceIdRef,
      currentWorkspaceIdRef,
      lastPreviewedSnapshotRef,
      workspaceRevisionRef,
      workspaceStoresRef,
      lastComponentsSnapshotRef,
      lastPendingTimestampRef,
      replayingWorkspaceRef,
      lastSavedPayloadHashRef,
      lastPanelSnapshotHashRef,
      ownedNotesRef,
      inferredWorkspaceNotesRef,
      previousVisibleWorkspaceRef,
      lastSaveReasonRef,
      saveInFlightRef,
      skipSavesUntilRef,
      workspaceDirtyRef,
      saveTimeoutRef,
      isHydratingRef,
      lastCameraRef,
      previousEntryIdRef,
      unavailableNoticeShownRef,
      lastHydratedWorkspaceIdRef,
      captureRetryAttemptsRef,
      deferredCachedCaptureCountRef,
      persistWorkspaceByIdRef,
      captureSnapshotRef,
      emitDebugLogRef,
      ensureRuntimePreparedRef,
      pruneWorkspaceEntriesRef,
      listedOnceRef,
    }),
    // These refs are stable and don't change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Use extracted persistence hook
  const {
    buildPayload,
    persistWorkspaceById,
    persistWorkspaceNow,
    scheduleSave,
    flushPendingSave,
    handleEntryChange,
  } = useWorkspacePersistence({
    refs: workspaceRefsForHooks,
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
    setStatusHelperText: (text: string) => setStatusHelperText(text),
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
  })

  // Use extracted hydration hook
  const { hydrateWorkspace } = useWorkspaceHydration({
    refs: workspaceRefsForHooks,
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
    setStatusHelperText: (text: string) => setStatusHelperText(text),
    setActiveNoteId,
    setCanvasState: setCanvasState ?? null,
    markUnavailable,
    bumpSnapshotRevision,
    setWorkspaceNoteMembership,
    commitWorkspaceOpenNotes,
    filterPanelsForWorkspace,
    updatePanelSnapshotMap,
    applyPanelSnapshots,
    openWorkspaceNote,
    closeWorkspaceNote,
  })

  // Use extracted CRUD hook
  const {
    createWorkspace: handleCreateWorkspaceFromHook,
    deleteWorkspace: handleDeleteWorkspaceFromHook,
    renameWorkspace: handleRenameWorkspaceFromHook,
  } = useWorkspaceCrud({
    featureEnabled,
    currentEntryId,
    currentWorkspaceId,
    workspaces,
    adapterRef,
    workspaceNoteMembershipRef,
    workspaceOpenNotesRef,
    ownedNotesRef,
    setWorkspaces,
    setCurrentWorkspaceId,
    setStatusHelperText,
    setWorkspaceNoteMembership,
    commitWorkspaceOpenNotes,
    ensureRuntimePrepared,
    flushPendingSave,
    buildPayload,
    emitDebugLog,
  })

  // Use extracted selection hook
  const {
    selectWorkspace: handleSelectWorkspaceFromHook,
  } = useWorkspaceSelection({
    liveStateEnabled,
    v2Enabled,
    currentWorkspaceId,
    pendingWorkspaceId,
    setPendingWorkspaceId,
    setCurrentWorkspaceId,
    adapterRef,
    currentWorkspaceIdRef,
    snapshotOwnerWorkspaceIdRef,
    workspaceSnapshotsRef,
    workspaceRevisionRef,
    setWorkspaceNoteMembership,
    filterPanelsForWorkspace,
    applyPanelSnapshots,
    captureCurrentWorkspaceSnapshot,
    previewWorkspaceFromSnapshot,
    persistWorkspaceNow,
    ensureRuntimePrepared,
    lastSaveReasonRef,
    emitDebugLog,
  })

  // NOTE: The following inline implementations of buildPayload, persistWorkspaceById, scheduleSave,
  // flushPendingSave, persistWorkspaceNow, handleEntryChange, and hydrateWorkspace have been extracted
  // to use-workspace-persistence.ts and use-workspace-hydration.ts.
  // Keep the old code commented for reference during migration, then delete after verification.


  useEffect(() => {
    if (!flagEnabled || isUnavailable) return
    if (listedOnceRef.current) return
    adapterRef.current = new NoteWorkspaceAdapter()
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
  }, [flagEnabled, isUnavailable, emitDebugLog, markUnavailable])

  // Subscribe to external workspace list refresh requests (e.g., after LinksNotePanel creates a workspace)
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
  }, [flagEnabled, isUnavailable, emitDebugLog])

  useEffect(() => {
    if (!featureEnabled || !isWorkspaceReady || !currentWorkspaceId) return
    if (lastHydratedWorkspaceIdRef.current === currentWorkspaceId) return
    // FIX: Skip hydration for HOT runtimes that have actual notes.
    // When a workspace has a hot runtime WITH notes, calling hydrateWorkspace would:
    // 1. Load potentially stale data from DB
    // 2. Call updatePanelSnapshotMap with allowEmpty:true, clearing panel caches
    // 3. Conflict with the hot runtime's in-memory state
    // This caused notes to "appear and instantly disappear" because the cache clearing
    // destroyed the panel data that the hot runtime was relying on.
    //
    // IMPORTANT: We only skip hydration if the runtime has actual notes (openNotes.length > 0).
    // On app reload, runtimes are created EMPTY before hydration runs. If we skip hydration
    // for empty runtimes, the workspace would never load its saved state from the DB.
    // We do NOT update lastHydratedWorkspaceIdRef here so that if the runtime gets
    // evicted later, we will properly hydrate from DB on next switch.
    if (liveStateEnabled && hasWorkspaceRuntime(currentWorkspaceId)) {
      const runtimeOpenNotes = getRuntimeOpenNotes(currentWorkspaceId)
      const runtimeComponentCount = getRegisteredComponentCount(currentWorkspaceId)
      // Skip hydration if runtime has notes OR components (either indicates meaningful state)
      if (runtimeOpenNotes.length > 0 || runtimeComponentCount > 0) {
        // Phase 1 Unification: Check runtime ledger first (authoritative source)
        const runtimeLedgerCount = getRuntimeComponentCount(currentWorkspaceId)

        // FIX 6 + Phase 1 Unification: When skipping hydration due to hot runtime, check if
        // components need restoration. React components deregister on unmount, so
        // runtimeComponentCount may be 0 even though component DATA exists in cache or ledger.
        if (runtimeComponentCount === 0) {
          // Try to get components from: runtime ledger > cache > snapshot
          const cachedComponents = lastComponentsSnapshotRef.current.get(currentWorkspaceId)
          const snapshotComponents = workspaceSnapshotsRef.current.get(currentWorkspaceId)?.components
          const componentsToRestore = cachedComponents ?? snapshotComponents

          if (componentsToRestore && componentsToRestore.length > 0) {
            // Phase 1 Unification: Always populate runtime ledger first (authoritative source)
            if (runtimeLedgerCount === 0) {
              populateRuntimeComponents(currentWorkspaceId, componentsToRestore)
            }

            // Also register to LayerManager for rendering
            const layerMgr = getWorkspaceLayerManager(currentWorkspaceId)
            if (layerMgr) {
              componentsToRestore.forEach((component) => {
                if (!component.id || !component.type) return
                const componentMetadata = {
                  ...(component.metadata ?? {}),
                  componentType: component.type,
                } as Record<string, unknown>
                layerMgr.registerNode({
                  id: component.id,
                  type: "component",
                  position: component.position ?? { x: 0, y: 0 },
                  dimensions: component.size ?? undefined,
                  zIndex: component.zIndex ?? undefined,
                  metadata: componentMetadata,
                } as any)
              })
              emitDebugLog({
                component: "NoteWorkspace",
                action: "hydrate_hot_runtime_component_restore",
                metadata: {
                  workspaceId: currentWorkspaceId,
                  componentCount: componentsToRestore.length,
                  runtimeLedgerCount,
                  source: cachedComponents ? "lastComponentsSnapshotRef" : "workspaceSnapshotsRef",
                },
              })
              // Bump revision to trigger canvas useEffect that reads from LayerManager.
              // This is safe for hot runtimes because the canvas's FIX 11 only sets
              // workspaceRestorationInProgressRef on first mount, not on revision bumps.
              bumpSnapshotRevision()
            }
          }
        }
        emitDebugLog({
          component: "NoteWorkspace",
          action: "hydrate_skipped_hot_runtime",
          metadata: {
            workspaceId: currentWorkspaceId,
            reason: "workspace_has_hot_runtime_with_state",
            runtimeNoteCount: runtimeOpenNotes.length,
            runtimeComponentCount,
          },
        })
        return
      }
      // Runtime exists but is empty (no notes, no components) - fall through to hydration
      emitDebugLog({
        component: "NoteWorkspace",
        action: "hydrate_empty_runtime",
        metadata: {
          workspaceId: currentWorkspaceId,
          reason: "runtime_exists_but_empty_will_hydrate",
        },
      })
    }
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
  }, [bumpSnapshotRevision, currentWorkspaceId, featureEnabled, hydrateWorkspace, isWorkspaceReady, liveStateEnabled])

  useEffect(() => {
    if (!featureEnabled) return
    const handleBeforeUnload = () => {
      flushPendingSave("before_unload")
    }
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushPendingSave("visibility_hidden")
      }
    }
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", handleBeforeUnload)
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility)
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", handleBeforeUnload)
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility)
      }
    }
  }, [featureEnabled, flushPendingSave])

  // Phase 3: Pre-eviction persistence callback - ENABLED
  // The runtime-manager now uses firePreEvictionCallbacksSync() which:
  // 1. Captures runtime state SYNCHRONOUSLY before deletion
  // 2. Stores it in capturedEvictionStates for callback access
  // 3. Fires callbacks (fire-and-forget) that persist asynchronously
  // 4. Then immediately proceeds with sync deletion
  // This allows persistence to happen in the background without blocking eviction.
  //
  // CRITICAL: This callback uses REFS (persistWorkspaceByIdRef, captureSnapshotRef, emitDebugLogRef)
  // instead of direct closure captures to avoid stale closure issues. During async awaits,
  // the hook may re-render and recreate these functions with new closures. Using refs ensures
  // we always call the LATEST version of each function, preventing bugs where:
  // - The wrong workspace gets persisted
  // - Logs show incorrect workspaceId values
  // - persist_by_id_start logs are missing
  useEffect(() => {
    if (!featureEnabled || !liveStateEnabled) return

    const preEvictionCallback: PreEvictionCallback = async (workspaceId: string, reason: string) => {
      // Capture the workspaceId in a const to ensure it doesn't change
      const targetWorkspaceId = workspaceId

      // Use refs to get the LATEST versions of functions (avoiding stale closures)
      const logFn = emitDebugLogRef.current
      const captureFn = captureSnapshotRef.current
      const persistFn = persistWorkspaceByIdRef.current

      logFn?.({
        component: "NoteWorkspace",
        action: "pre_eviction_callback_start",
        metadata: {
          workspaceId: targetWorkspaceId,
          reason,
          currentWorkspaceId: currentWorkspaceIdRef.current,
        },
      })

      try {
        // Capture snapshot first (uses runtime state or captured eviction state)
        if (captureFn) {
          await captureFn(targetWorkspaceId, {
            readinessReason: "pre_eviction_capture",
            readinessMaxWaitMs: 500,
            skipReadiness: true, // Don't wait for readiness during eviction - use what we have
          })
        }

        // Persist the captured state - use LATEST persistFn via ref
        let success = false
        const latestPersistFn = persistWorkspaceByIdRef.current
        if (latestPersistFn) {
          success = await latestPersistFn(targetWorkspaceId, `pre_eviction_${reason}`, {
            skipReadinessCheck: true,
            isBackground: true,
          })
        }

        // Use LATEST logFn via ref for completion log
        const latestLogFn = emitDebugLogRef.current
        latestLogFn?.({
          component: "NoteWorkspace",
          action: "pre_eviction_callback_complete",
          metadata: {
            workspaceId: targetWorkspaceId,
            reason,
            success,
          },
        })
      } catch (error) {
        // Use LATEST logFn via ref for error log
        const latestLogFn = emitDebugLogRef.current
        latestLogFn?.({
          component: "NoteWorkspace",
          action: "pre_eviction_callback_error",
          metadata: {
            workspaceId: targetWorkspaceId,
            reason,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      }
    }

    registerPreEvictionCallback(preEvictionCallback)

    return () => {
      unregisterPreEvictionCallback(preEvictionCallback)
    }
  }, [
    featureEnabled,
    liveStateEnabled,
    // Note: We intentionally DO NOT include captureCurrentWorkspaceSnapshot, persistWorkspaceById,
    // or emitDebugLog in deps. The callback uses refs to access the latest versions, so it
    // doesn't need to be re-registered when these functions change. This prevents unnecessary
    // unregister/register cycles that could cause race conditions during eviction.
  ])

  useEffect(() => {
    if (!featureEnabled || !v2Enabled) return
    const unsubscribe = subscribeToWorkspaceSnapshotState((event) => {
      if (event.type === "panel_pending") {
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
      } else if (event.type === "workspace_ready") {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "workspace_ready",
          metadata: {
            workspaceId: event.workspaceId,
            pendingCount: event.pendingCount,
            timestampMs: event.timestamp,
          },
        })
        if (
          featureEnabled &&
          v2Enabled &&
          event.workspaceId === currentWorkspaceId &&
          !isHydratingRef.current &&
          replayingWorkspaceRef.current === 0
        ) {
          void (async () => {
            await captureCurrentWorkspaceSnapshot()
            lastSaveReasonRef.current = "panel_ready_auto_save"
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
    persistWorkspaceNow,
    v2Enabled,
  ])

  useEffect(() => {
    if (!featureEnabled || !currentWorkspaceSummary) return
    if (isHydratingRef.current || replayingWorkspaceRef.current > 0) return
    scheduleSave({ reason: "state_change" })
  }, [
    activeNoteId,
    currentWorkspaceSummary,
    featureEnabled,
    openNotes,
    canvasState?.translateX,
    canvasState?.translateY,
    canvasState?.zoom,
    panelSnapshotVersion,
    scheduleSave,
  ])

  // Trigger save when component set changes (so default workspace captures non-note components)
  useEffect(() => {
    if (!featureEnabled) return
    if (isHydratingRef.current || replayingWorkspaceRef.current > 0) return
    scheduleSave({ reason: "components_changed" })
  }, [scheduleSave, featureEnabled, panelSnapshotVersion])

  // NOTE: handleCreateWorkspace, handleDeleteWorkspace, handleRenameWorkspace
  // extracted to use-workspace-crud.ts
  // NOTE: handleSelectWorkspace extracted to use-workspace-selection.ts

  useLayoutEffect(() => {
    if (!featureEnabled || v2Enabled || openNotes.length === 0) return
    const dataStore = sharedWorkspace?.dataStore
    if (!dataStore) return
    const hydrated: string[] = []
    openNotes.forEach((note) => {
      if (!note.noteId) return
      const snapshots = panelSnapshotsRef.current.get(note.noteId)
      if (!snapshots || snapshots.length === 0) return
      const missing = snapshots.some((panel) => {
        const key = ensurePanelKey(panel.noteId, panel.panelId)
        let exists = false
        if (typeof dataStore.has === "function") {
          try {
            exists = Boolean(dataStore.has(key))
          } catch {
            exists = false
          }
        }
        if (!exists) {
          exists = Boolean(dataStore.get(key))
        }
        return !exists
      })
      if (missing) {
        rehydratePanelsForNote(note.noteId)
        hydrated.push(note.noteId)
      }
    })
    if (hydrated.length > 0) {
      emitDebugLog({
        component: "NoteWorkspace",
        action: "panel_snapshot_rehydrated",
        metadata: {
          noteIds: hydrated,
          reason: "open_notes_refresh",
        },
      })
    }
  }, [featureEnabled, v2Enabled, openNotes, panelSnapshotVersion, sharedWorkspace, rehydratePanelsForNote, emitDebugLog])

  useEffect(() => {
    if (!v2Enabled || !currentWorkspaceId) return
    const snapshot = getWorkspaceSnapshot(currentWorkspaceId)
    if (!snapshot) return
    previewWorkspaceFromSnapshot(currentWorkspaceId, snapshot)
  }, [currentWorkspaceId, previewWorkspaceFromSnapshot, v2Enabled])

  useEffect(() => {
    if (!liveStateEnabled) return
    if (currentWorkspaceId) {
      void ensureRuntimePrepared(currentWorkspaceId, "current_workspace")
    }
  }, [currentWorkspaceId, ensureRuntimePrepared, liveStateEnabled])

  useEffect(() => {
    if (!liveStateEnabled) return
    if (pendingWorkspaceId) {
      void ensureRuntimePrepared(pendingWorkspaceId, "pending_workspace")
    }
  }, [ensureRuntimePrepared, liveStateEnabled, pendingWorkspaceId])

  useEffect(() => {
    if (!liveStateEnabled) return
    const prevVisible = previousVisibleWorkspaceRef.current
    if (prevVisible && prevVisible !== currentWorkspaceId) {
      emitDebugLog({
        component: "NoteWorkspaceRuntime",
        action: "workspace_runtime_hidden",
        metadata: {
          workspaceId: prevVisible,
          runtimeCount: listWorkspaceRuntimeIds().length,
        },
      })
    }
    if (currentWorkspaceId) {
      const wasCold = !runtimeAccessRef.current.has(currentWorkspaceId)
      emitDebugLog({
        component: "NoteWorkspaceRuntime",
        action: "workspace_runtime_visible",
        metadata: {
          workspaceId: currentWorkspaceId,
          wasCold,
          runtimeCount: listWorkspaceRuntimeIds().length,
        },
      })
      updateRuntimeAccess(currentWorkspaceId)
    }
    previousVisibleWorkspaceRef.current = currentWorkspaceId ?? null
  }, [currentWorkspaceId, emitDebugLog, liveStateEnabled, updateRuntimeAccess])

  useEffect(() => {
    if (!featureEnabled || !activeNoteId) return
    const snapshots = panelSnapshotsRef.current.get(activeNoteId)
    if (!snapshots || snapshots.length === 0) return
    const workspaceIdForNote =
      ownedNotesRef.current.get(activeNoteId) ??
      snapshotOwnerWorkspaceIdRef.current ??
      currentWorkspaceId ??
      currentWorkspaceIdRef.current ??
      null
    const dataStore = getWorkspaceDataStore(workspaceIdForNote)
    if (!dataStore) return
    const hasAllPanels = snapshots.every((panel) => {
      const key = ensurePanelKey(panel.noteId, panel.panelId)
      let exists = false
      if (typeof dataStore.has === "function") {
        try {
          exists = Boolean(dataStore.has(key))
        } catch {
          exists = false
        }
      }
      if (!exists) {
        exists = Boolean(dataStore.get(key))
      }
      return exists
    })
    if (hasAllPanels) return
    emitDebugLog({
      component: "NoteWorkspace",
      action: "panel_snapshot_missing",
      metadata: {
        noteIds: [activeNoteId],
        reason: "active_note_check",
      },
    })
    rehydratePanelsForNote(activeNoteId, workspaceIdForNote ?? undefined)
  }, [
    activeNoteId,
    currentWorkspaceId,
    featureEnabled,
    getWorkspaceDataStore,
    rehydratePanelsForNote,
    emitDebugLog,
  ])

  /**
   * Clear a deleted component from the lastComponentsSnapshotRef cache.
   * This prevents hydration from trying to restore deleted components,
   * which would cause an infinite loop.
   */
  const clearDeletedComponentFromCache = useCallback(
    (workspaceId: string, componentId: string) => {
      const cached = lastComponentsSnapshotRef.current.get(workspaceId)
      if (!cached) return

      const filtered = cached.filter(c => c.id !== componentId)
      if (filtered.length !== cached.length) {
        lastComponentsSnapshotRef.current.set(workspaceId, filtered)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "cleared_deleted_component_from_cache",
          metadata: {
            workspaceId,
            componentId,
            remainingCount: filtered.length,
          },
        })
      }
    },
    [emitDebugLog],
  )

  /**
   * Clear a closed note from the workspace snapshot caches.
   * This prevents hydration from trying to restore closed notes,
   * which would cause the note to briefly appear then disappear (stale toolbar state).
   * Similar pattern to clearDeletedComponentFromCache.
   */
  const clearClosedNoteFromCache = useCallback(
    (workspaceId: string, noteId: string) => {
      let clearedFromOpenNotes = false
      let clearedFromPanels = false
      let clearedFromNonEmpty = false

      // Clear from workspaceSnapshotsRef.openNotes
      const cached = workspaceSnapshotsRef.current.get(workspaceId)
      if (cached) {
        const filteredOpenNotes = cached.openNotes.filter(n => n.noteId !== noteId)
        if (filteredOpenNotes.length !== cached.openNotes.length) {
          cached.openNotes = filteredOpenNotes
          clearedFromOpenNotes = true
        }

        // Also clear panels for this note
        const filteredPanels = cached.panels.filter(p => p.noteId !== noteId)
        if (filteredPanels.length !== cached.panels.length) {
          cached.panels = filteredPanels
          clearedFromPanels = true
        }
      }

      // Clear from lastNonEmptySnapshotsRef
      const nonEmpty = lastNonEmptySnapshotsRef.current.get(workspaceId)
      if (nonEmpty && nonEmpty.length > 0) {
        const filteredNonEmpty = nonEmpty.filter(p => p.noteId !== noteId)
        if (filteredNonEmpty.length !== nonEmpty.length) {
          lastNonEmptySnapshotsRef.current.set(workspaceId, filteredNonEmpty)
          clearedFromNonEmpty = true
        }
      }

      if (clearedFromOpenNotes || clearedFromPanels || clearedFromNonEmpty) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "cleared_closed_note_from_cache",
          metadata: {
            workspaceId,
            noteId,
            clearedFromOpenNotes,
            clearedFromPanels,
            clearedFromNonEmpty,
            remainingOpenNotes: cached?.openNotes.length ?? 0,
            remainingPanels: cached?.panels.length ?? 0,
          },
        })
      }
    },
    [emitDebugLog],
  )

  return {
    featureEnabled,
    isUnavailable,
    workspaces,
    workspacesForCurrentEntry,
    isLoading,
    statusHelperText,
    currentWorkspaceId,
    targetWorkspaceId,
    currentEntryId,
    setCurrentEntryId: handleEntryChange,
    snapshotRevision,
    selectWorkspace: handleSelectWorkspaceFromHook,
    createWorkspace: handleCreateWorkspaceFromHook,
    deleteWorkspace: handleDeleteWorkspaceFromHook,
    renameWorkspace: handleRenameWorkspaceFromHook,
    scheduleImmediateSave: flushPendingSave,
    clearDeletedComponentFromCache,
    clearClosedNoteFromCache,
  }
}
