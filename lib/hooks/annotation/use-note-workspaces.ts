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

  // NOTE: The following inline implementations of setWorkspaceNoteMembership, getWorkspaceNoteMembership,
  // commitWorkspaceOpenNotes, and getWorkspaceOpenNotes have been extracted to use-workspace-membership.ts
  // Keep the old code commented for reference during migration, then delete after verification.

  /* EXTRACTED TO use-workspace-membership.ts
  const setWorkspaceNoteMembership = useCallback(
    (
      workspaceId: string | null | undefined,
      noteIds: Iterable<string | null | undefined>,
      timestamp?: number,
    ) => {
      if (!workspaceId) return
      const normalized = new Set<string>()
      for (const noteId of noteIds) {
        if (typeof noteId === "string" && noteId.length > 0) {
          normalized.add(noteId)
        }
      }

      const writeTimestamp = timestamp ?? Date.now()

      // DEBUG: Log what's being set with call stack
      const stack = new Error().stack?.split('\n').slice(2, 6).join(' | ') ?? 'no-stack'
      emitDebugLog({
        component: "NoteWorkspace",
        action: "set_workspace_membership_called",
        metadata: {
          workspaceId,
          inputNoteIds: Array.from(noteIds),
          normalizedNoteIds: Array.from(normalized),
          normalizedSize: normalized.size,
          previousSize: workspaceNoteMembershipRef.current.get(workspaceId)?.size ?? null,
          timestamp: writeTimestamp,
          callStack: stack,
        },
      })

      // Phase 1: Write to runtime FIRST when live state enabled (prevents stale overwrites)
      if (liveStateEnabled) {
        setRuntimeMembership(workspaceId, normalized, writeTimestamp)
      }

      // Keep ref in sync as backup/legacy fallback
      const previous = workspaceNoteMembershipRef.current.get(workspaceId)
      let shouldUpdateMembership = true
      if (previous && previous.size === normalized.size) {
        shouldUpdateMembership = false
        for (const value of normalized) {
          if (!previous.has(value)) {
            shouldUpdateMembership = true
            break
          }
        }
      }
      if (shouldUpdateMembership) {
        workspaceNoteMembershipRef.current.set(workspaceId, normalized)
      }

      if (liveStateEnabled) {
        // DEBUG: Verify what was actually set in runtime
        const verifySet = getRuntimeMembership(workspaceId)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "set_workspace_membership_verified",
          metadata: {
            workspaceId,
            attemptedToSet: Array.from(normalized),
            actuallySet: verifySet ? Array.from(verifySet) : null,
            matchesExpected: verifySet?.size === normalized.size,
          },
        })
      }
      if (!v2Enabled) {
        return
      }
      const previouslyOwnedByWorkspace = new Set<string>()
      ownedNotesRef.current.forEach((ownerWorkspaceId, noteId) => {
        if (ownerWorkspaceId === workspaceId) {
          previouslyOwnedByWorkspace.add(noteId)
        }
      })
      normalized.forEach((noteId) => {
        const existingOwner = ownedNotesRef.current.get(noteId)
        if (existingOwner && existingOwner !== workspaceId) {
          const existingMembership = workspaceNoteMembershipRef.current.get(existingOwner)
          existingMembership?.delete(noteId)
        }
        if (existingOwner !== workspaceId) {
          // Phase 1: Use runtime ownership when live state enabled
          if (liveStateEnabled) {
            setRuntimeNoteOwner(workspaceId, noteId)
          } else {
            setNoteWorkspaceOwner(noteId, workspaceId)
          }
          ownedNotesRef.current.set(noteId, workspaceId)
        }
        previouslyOwnedByWorkspace.delete(noteId)
      })
      previouslyOwnedByWorkspace.forEach((noteId) => {
        // Phase 1: Use runtime ownership when live state enabled
        if (liveStateEnabled) {
          clearRuntimeNoteOwner(workspaceId, noteId)
        } else {
          clearNoteWorkspaceOwner(noteId)
        }
        ownedNotesRef.current.delete(noteId)
      })
    },
    [liveStateEnabled, v2Enabled],
  )

  const getWorkspaceNoteMembership = useCallback(
    (workspaceId: string | null | undefined): Set<string> | null => {
      if (!workspaceId) return null
      // Phase 1: When live state enabled, runtime is the ONLY source of truth
      if (liveStateEnabled) {
        return getRuntimeMembership(workspaceId)  // Even if null/empty
      }
      // Legacy mode: Use ref fallback when live state is disabled
      return workspaceNoteMembershipRef.current.get(workspaceId) ?? null
    },
    [liveStateEnabled],
  )

  const commitWorkspaceOpenNotes = useCallback(
    (
      workspaceId: string | null | undefined,
      slots:
        | Iterable<{
            noteId?: string | null
            mainPosition?: { x: number; y: number } | null
            position?: { x: number; y: number } | null
          }>
        | null
        | undefined,
      options?: { updateMembership?: boolean; updateCache?: boolean; timestamp?: number; callSite?: string },
    ): NoteWorkspaceSlot[] => {
      if (!workspaceId) return []
      const normalized = normalizeWorkspaceSlots(slots)
      const writeTimestamp = options?.timestamp ?? Date.now()

      // DEBUG: Trace note addition timing with call site for stale-write diagnosis
      const debugStartTime = performance.now()
      void debugLog({
        component: "NoteDelay",
        action: "commit_open_notes_start",
        metadata: {
          workspaceId,
          noteCount: normalized.length,
          noteIds: normalized.map(n => n.noteId),
          liveStateEnabled,
          timestampMs: debugStartTime,
          callSite: options?.callSite ?? "unknown",
        },
      })

      // Phase 1: Write to runtime FIRST when live state enabled (prevents stale overwrites)
      if (liveStateEnabled) {
        setRuntimeOpenNotes(workspaceId, normalized, writeTimestamp)
      }

      // Keep ref in sync as backup/legacy fallback
      const previous = workspaceOpenNotesRef.current.get(workspaceId)
      const changed = !areWorkspaceSlotsEqual(previous, normalized)
      if (changed) {
        workspaceOpenNotesRef.current.set(workspaceId, normalized)
      }

      const shouldUpdateMembership = options?.updateMembership ?? true
      const shouldUpdateCache = options?.updateCache ?? true
      if (shouldUpdateMembership) {
        setWorkspaceNoteMembership(
          workspaceId,
          normalized.map((entry) => entry.noteId),
          writeTimestamp,
        )
      }
      if (shouldUpdateCache) {
        const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, workspaceId)
        cache.openNotes = normalized
      }

      // DEBUG: Trace note addition timing
      void debugLog({
        component: "NoteDelay",
        action: "commit_open_notes_end",
        metadata: {
          workspaceId,
          noteCount: normalized.length,
          durationMs: performance.now() - debugStartTime,
        },
      })

      return normalized
    },
    [liveStateEnabled, setWorkspaceNoteMembership],
  )

  const getWorkspaceOpenNotes = useCallback(
    (workspaceId: string | null | undefined): NoteWorkspaceSlot[] => {
      if (!workspaceId) return []

      // DEBUG: Trace note reading timing
      void debugLog({
        component: "NoteDelay",
        action: "get_open_notes_called",
        metadata: {
          workspaceId,
          liveStateEnabled,
          timestampMs: performance.now(),
        },
      })

      // Phase 1: When live state enabled, runtime is the ONLY source of truth
      // No fallbacks to provider/refs/cache - they would overwrite runtime
      if (liveStateEnabled) {
        let runtimeSlots = getRuntimeOpenNotes(workspaceId)

        // Phase 3: Fall back to captured eviction state if runtime is empty/deleted
        // This happens during pre-eviction persistence when callback runs after runtime deletion
        if (runtimeSlots.length === 0) {
          const capturedState = getCapturedEvictionState(workspaceId)
          if (capturedState && capturedState.openNotes.length > 0) {
            runtimeSlots = capturedState.openNotes
            void debugLog({
              component: "NoteDelay",
              action: "get_open_notes_from_captured_eviction_state",
              metadata: {
                workspaceId,
                noteCount: runtimeSlots.length,
                noteIds: runtimeSlots.map(n => n.noteId),
                reason: "runtime_empty_using_captured_state",
              },
            })
          }
        }

        // DEBUG: Log what we got from runtime
        void debugLog({
          component: "NoteDelay",
          action: "get_open_notes_result_live_state",
          metadata: {
            workspaceId,
            noteCount: runtimeSlots.length,
            noteIds: runtimeSlots.map(n => n.noteId),
            timestampMs: performance.now(),
          },
        })
        // Keep ref in sync for debugging/legacy compatibility
        const stored = workspaceOpenNotesRef.current.get(workspaceId)
        if (!areWorkspaceSlotsEqual(stored, runtimeSlots)) {
          workspaceOpenNotesRef.current.set(workspaceId, runtimeSlots)
        }
        return runtimeSlots
      }

      // Legacy mode: Use fallback chain when live state is disabled
      const stored = workspaceOpenNotesRef.current.get(workspaceId)
      if (stored && stored.length > 0) {
        return stored
      }
      const cachedSnapshot = workspaceSnapshotsRef.current.get(workspaceId)
      if (stored && stored.length === 0 && cachedSnapshot && cachedSnapshot.openNotes.length > 0) {
        return commitWorkspaceOpenNotes(workspaceId, cachedSnapshot.openNotes, { updateMembership: false, callSite: "getOpenNotes_cachedSnapshot1" })
      }
      const canUseProvider =
        openNotesWorkspaceId &&
        openNotesWorkspaceId === workspaceId &&
        replayingWorkspaceRef.current === 0 &&
        !isHydratingRef.current
      if (canUseProvider && openNotes.length > 0) {
        return commitWorkspaceOpenNotes(workspaceId, openNotes, { updateCache: false, callSite: "getOpenNotes_provider" })
      }
      if (cachedSnapshot && cachedSnapshot.openNotes.length > 0) {
        return commitWorkspaceOpenNotes(workspaceId, cachedSnapshot.openNotes, { updateMembership: false, callSite: "getOpenNotes_cachedSnapshot2" })
      }
      const membership = workspaceNoteMembershipRef.current.get(workspaceId)
      if (membership && membership.size > 0) {
        const inferred = Array.from(membership).map((noteId) => ({ noteId, mainPosition: null }))
        return commitWorkspaceOpenNotes(workspaceId, inferred, { updateCache: false, callSite: "getOpenNotes_membership" })
      }
      return stored ?? []
    },
    [commitWorkspaceOpenNotes, getRuntimeOpenNotes, liveStateEnabled, openNotes, openNotesWorkspaceId],
  )
  END OF EXTRACTED MEMBERSHIP FUNCTIONS */

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

  // NOTE: The following inline implementations of filterPanelsForWorkspace, getRuntimeDataStore,
  // getWorkspaceDataStore, collectPanelSnapshotsFromDataStore, getAllPanelSnapshots,
  // updatePanelSnapshotMap, and waitForPanelSnapshotReadiness have been extracted to
  // use-workspace-panel-snapshots.ts. Keep the old code commented for reference during migration.

  /* EXTRACTED TO use-workspace-panel-snapshots.ts
  const filterPanelsForWorkspace = useCallback(
    (workspaceId: string | null | undefined, panels: NoteWorkspacePanelSnapshot[]) => {
      if (!workspaceId) return panels
      if (!v2Enabled) {
        return panels
      }
      const membership = getWorkspaceNoteMembership(workspaceId)
      if (!membership) {
        return []
      }
      if (membership.size === 0) {
        return []
      }
      return panels.filter((panel) => {
        if (!panel.noteId) return false
        return membership.has(panel.noteId)
      })
    },
    [getWorkspaceNoteMembership, v2Enabled],
  )

  const getRuntimeDataStore = useCallback(
    (workspaceId: string | null | undefined): DataStore | null => {
      if (!liveStateEnabled || !workspaceId) return null
      return getWorkspaceRuntime(workspaceId).dataStore
    },
    [liveStateEnabled],
  )

  const getWorkspaceDataStore = useCallback(
    (workspaceId: string | null | undefined) => {
      if (!v2Enabled) {
        return sharedWorkspace?.dataStore ?? null
      }
      if (liveStateEnabled) {
        if (!workspaceId) return null
        return getRuntimeDataStore(workspaceId)
      }
      return getWorkspaceStore(workspaceId ?? undefined)
    },
    [sharedWorkspace?.dataStore, v2Enabled, liveStateEnabled, getRuntimeDataStore],
  )
  END OF EXTRACTED PANEL SNAPSHOT HELPERS (filterPanelsForWorkspace, getRuntimeDataStore, getWorkspaceDataStore) */

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

  /* EXTRACTED TO use-workspace-panel-snapshots.ts (continued)
  // FIX 9: Accept optional targetWorkspaceId parameter to prevent workspace ID mismatch.
  // Previously, this function independently resolved the workspace ID using refs that could
  // be stale (snapshotOwnerWorkspaceIdRef → currentWorkspaceIdRef → currentWorkspaceId),
  // while buildPayload used a different order (currentWorkspaceId → snapshotOwnerWorkspaceIdRef
  // → currentWorkspaceIdRef). This mismatch caused panels from one workspace to be read and
  // saved to another workspace when refs were stale during workspace transitions.
  const collectPanelSnapshotsFromDataStore = useCallback((targetWorkspaceId?: string | null): NoteWorkspacePanelSnapshot[] => {
    const snapshots: NoteWorkspacePanelSnapshot[] = []
    // FIX 9: Prefer targetWorkspaceId if explicitly provided by caller (e.g., buildPayload)
    const activeWorkspaceId = targetWorkspaceId ?? snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
    const primaryStore = getWorkspaceDataStore(activeWorkspaceId)
    const workspaceMembership = getWorkspaceNoteMembership(activeWorkspaceId)
    const membershipKnown = workspaceMembership !== null && workspaceMembership !== undefined
    const inferredNoteIds = new Set<string>()

    const collectFromStore = (store: DataStore | null) => {
      if (!store || typeof store.keys !== "function") return
      for (const key of store.keys() as Iterable<string>) {
        const rawKey = String(key)
        const parsed = parsePanelKey(rawKey)
        const noteId = parsed?.noteId
        const panelId = parsed?.panelId ?? "main"
        if (!noteId) continue
        const record = store.get(rawKey)
        const snapshot = buildPanelSnapshotFromRecord(noteId, panelId, record)
        if (snapshot) {
          snapshots.push(snapshot)
        }
      }
    }

    collectFromStore(primaryStore)
    if (!v2Enabled && snapshots.length === 0) {
      const fallbackStore = sharedWorkspace?.dataStore ?? getWorkspaceDataStore(SHARED_WORKSPACE_ID)
      if (fallbackStore && fallbackStore !== primaryStore) {
        collectFromStore(fallbackStore)
      }
    }
    if (!primaryStore) {
      return []
    }
    if (v2Enabled && !membershipKnown) {
      return []
    }
    const ownedNotesForWorkspace = ownedNotesRef.current
    if (workspaceMembership) {
      if (workspaceMembership.size === 0) {
        const ownedPanels = snapshots.filter(
          (snapshot) => snapshot.noteId && ownedNotesForWorkspace.get(snapshot.noteId) === activeWorkspaceId,
        )
        if (activeWorkspaceId) {
          if (ownedPanels.length === 0) {
            inferredWorkspaceNotesRef.current.delete(activeWorkspaceId)
          } else {
            inferredWorkspaceNotesRef.current.set(
              activeWorkspaceId,
              new Set(ownedPanels.map((panel) => panel.noteId!).filter(Boolean)),
            )
          }
        }
        return ownedPanels
      }
      const filtered = snapshots.filter((snapshot) => {
        if (!snapshot.noteId) return false
        if (workspaceMembership.has(snapshot.noteId)) {
          return true
        }
        const owner = ownedNotesForWorkspace.get(snapshot.noteId)
        if (owner === activeWorkspaceId) {
          return true
        }
        if (!owner && activeWorkspaceId) {
          inferredNoteIds.add(snapshot.noteId)
          return true
        }
        return false
      })
      if (activeWorkspaceId) {
        if (inferredNoteIds.size > 0) {
          inferredWorkspaceNotesRef.current.set(activeWorkspaceId, new Set(inferredNoteIds))
        } else {
          inferredWorkspaceNotesRef.current.delete(activeWorkspaceId)
        }
      }
      return filtered
    }
    if (activeWorkspaceId) {
      inferredWorkspaceNotesRef.current.delete(activeWorkspaceId)
    }
    return snapshots
  }, [currentWorkspaceId, getWorkspaceDataStore, getWorkspaceNoteMembership, sharedWorkspace, v2Enabled])

  const getAllPanelSnapshots = useCallback(
    (options?: { useFallback?: boolean }): NoteWorkspacePanelSnapshot[] => {
      const useFallback = options?.useFallback ?? true
      const workspaceId =
        snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
      if (workspaceId && workspaceSnapshotsRef.current.has(workspaceId)) {
        const storedPanels = workspaceSnapshotsRef.current.get(workspaceId)?.panels ?? []
        if (storedPanels.length > 0 || !useFallback) return storedPanels
        const fallback = getLastNonEmptySnapshot(
          workspaceId,
          lastNonEmptySnapshotsRef.current,
          workspaceSnapshotsRef.current,
        )
        if (fallback.length > 0) return fallback
        return storedPanels
      }
      if (panelSnapshotsRef.current.size > 0) {
        return Array.from(panelSnapshotsRef.current.values()).flat()
      }
      const collected = collectPanelSnapshotsFromDataStore()
      if (workspaceId && collected.length === 0 && useFallback) {
        const fallback = getLastNonEmptySnapshot(
          workspaceId,
          lastNonEmptySnapshotsRef.current,
          workspaceSnapshotsRef.current,
        )
        if (fallback.length > 0) return fallback
      }
      return collected
    },
    [collectPanelSnapshotsFromDataStore, currentWorkspaceId],
  )

  const updatePanelSnapshotMap = useCallback(
    (
      panels: NoteWorkspacePanelSnapshot[],
      reason: string,
      options?: { allowEmpty?: boolean; mergeWithExisting?: boolean },
    ) => {
      const allowEmpty = options?.allowEmpty ?? false
      const mergeWithExisting = options?.mergeWithExisting ?? false
      let ownerId =
        snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
      if (!snapshotOwnerWorkspaceIdRef.current && ownerId) {
        snapshotOwnerWorkspaceIdRef.current = ownerId
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_owner_fallback",
          metadata: {
            reason,
            fallbackWorkspaceId: ownerId,
            panelCount: panels.length,
            noteIds: Array.from(new Set(panels.map((panel) => panel.noteId))),
          },
        })
      }
      if (!ownerId) {
        const activeId = currentWorkspaceIdRef.current ?? currentWorkspaceId
        if (activeId) {
          ownerId = activeId
          snapshotOwnerWorkspaceIdRef.current = activeId
          emitDebugLog({
            component: "NoteWorkspace",
            action: "panel_snapshot_owner_fallback_attach",
            metadata: {
              reason,
              fallbackWorkspaceId: activeId,
              panelCount: panels.length,
              noteIds: Array.from(new Set(panels.map((panel) => panel.noteId))),
              timestampMs: Date.now(),
            },
          })
        } else {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "panel_snapshot_skipped_no_owner",
            metadata: {
              reason,
              panelCount: panels.length,
              noteIds: Array.from(new Set(panels.map((panel) => panel.noteId))),
              timestampMs: Date.now(),
            },
          })
          return
        }
      }

      ownerId = snapshotOwnerWorkspaceIdRef.current ?? ownerId
      const fallbackPanels = ownerId
        ? getLastNonEmptySnapshot(ownerId, lastNonEmptySnapshotsRef.current, workspaceSnapshotsRef.current)
        : []
      let panelsToPersist =
        panels.length > 0
          ? panels
          : allowEmpty
            ? []
            : fallbackPanels
      if (!allowEmpty && panels.length === 0 && fallbackPanels.length > 0) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_fallback_to_last_non_empty",
          metadata: {
            reason,
            workspaceId: ownerId,
            cachedPanelCount: fallbackPanels.length,
          },
        })
      }
      if (mergeWithExisting && ownerId && panelsToPersist.length > 0) {
        const existingPanels = workspaceSnapshotsRef.current.get(ownerId)?.panels ?? []
        if (existingPanels.length > 0) {
          const updatedNoteIds = new Set(
            panelsToPersist
              .map((panel) => (panel.noteId ? String(panel.noteId) : null))
              .filter((id): id is string => Boolean(id)),
          )
          const preservedPanels = existingPanels.filter((panel) => {
            if (!panel.noteId) return false
            return !updatedNoteIds.has(panel.noteId)
          })
          panelsToPersist = mergePanelSnapshots(preservedPanels, panelsToPersist)
          emitDebugLog({
            component: "NoteWorkspace",
            action: "panel_snapshot_merge_existing",
            metadata: {
              workspaceId: ownerId,
              mergedCount: panelsToPersist.length,
              updatedNoteIds: Array.from(updatedNoteIds),
            },
          })
        }
      }

      const snapshotHash = serializePanelSnapshots(panelsToPersist)
      if (snapshotHash === lastPanelSnapshotHashRef.current) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_skip_duplicate",
          metadata: {
            workspaceId: ownerId,
            reason,
            panelCount: panelsToPersist.length,
          },
        })
        return
      }
      lastPanelSnapshotHashRef.current = snapshotHash

      if (!panelsToPersist || panelsToPersist.length === 0) {
        if (allowEmpty) {
          const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, ownerId)
          cache.panels = []
          workspaceNoteMembershipRef.current.set(ownerId, new Set())
          // FIX: Do NOT delete lastNonEmptySnapshotsRef here.
          // This ref serves as a fallback when panels are temporarily empty (e.g., during hydration
          // of a workspace that was saved with 0 panels due to DataStore not being seeded).
          // Keeping the fallback allows buildPayload to recover panels at line 2484.
          // Previously, deleting it here caused a feedback loop where:
          // 1. Workspace saved with 0 panels (DataStore not seeded)
          // 2. hydrateWorkspace loads 0 panels, calls this with allowEmpty=true
          // 3. lastNonEmptySnapshotsRef deleted, destroying the fallback
          // 4. Next save also has 0 panels, and so on...
          emitDebugLog({
            component: "NoteWorkspace",
            action: "panel_snapshot_cleared",
            metadata: {
              reason,
              workspaceId: ownerId,
              preservedFallback: lastNonEmptySnapshotsRef.current.has(ownerId),
            },
          })
          const dataStore = getWorkspaceDataStore(ownerId)
          if (dataStore && typeof dataStore.keys === "function") {
            const keys: string[] = []
            for (const key of dataStore.keys() as Iterable<string>) {
              keys.push(String(key))
            }
            keys.forEach((key) => dataStore.delete(key))
          }
        } else {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "panel_snapshot_skip_empty_no_fallback",
            metadata: {
              reason,
              workspaceId: ownerId,
            },
          })
        }
        return
      }
      const next = new Map(panelSnapshotsRef.current)
      panelsToPersist.forEach((panel) => {
        if (!panel.noteId) return
        const existing = next.get(panel.noteId) ?? []
        const filtered = existing.filter((entry) => entry.panelId !== panel.panelId)
        filtered.push(panel)
        next.set(panel.noteId, filtered)
      })
      panelSnapshotsRef.current = next
      if (ownerId) {
        const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, ownerId)
        cache.panels = panelsToPersist
        if (!workspaceNoteMembershipRef.current.has(ownerId)) {
          const inferredNoteIds = new Set(
            panelsToPersist
              .map((panel) => panel.noteId)
              .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
          )
          workspaceNoteMembershipRef.current.set(ownerId, inferredNoteIds)
        }
      }
      emitDebugLog({
        component: "NoteWorkspace",
        action: "panel_snapshot_updated",
        metadata: {
          reason,
          panelCount: panelsToPersist.length,
          noteIds: Array.from(new Set(panelsToPersist.map((panel) => panel.noteId))),
          workspaceId: ownerId,
          timestampMs: Date.now(),
          cachedWorkspaceCount: workspaceSnapshotsRef.current.size,
        },
      })
    },
    [emitDebugLog, v2Enabled, getWorkspaceDataStore, currentWorkspaceId],
  )

  useEffect(() => {
    const activeWorkspaceId = snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
    const dataStore = getWorkspaceDataStore(activeWorkspaceId)
    if (!dataStore || typeof dataStore.on !== "function" || typeof dataStore.off !== "function") {
      return undefined
    }
    if (v2Enabled && activeWorkspaceId && !snapshotOwnerWorkspaceIdRef.current) {
      snapshotOwnerWorkspaceIdRef.current = activeWorkspaceId
    }

    const handleMutation = () => {
      if (replayingWorkspaceRef.current > 0) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_skip_during_replay",
          metadata: {
            workspaceId: snapshotOwnerWorkspaceIdRef.current,
          },
        })
        return
      }
      const snapshots = collectPanelSnapshotsFromDataStore()
      const snapshotHash = serializePanelSnapshots(snapshots)
      if (snapshotHash === lastPanelSnapshotHashRef.current) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_skip_no_changes",
          metadata: {
            workspaceId: snapshotOwnerWorkspaceIdRef.current,
            panelCount: snapshots.length,
          },
        })
        return
      }
      lastPanelSnapshotHashRef.current = snapshotHash
      updatePanelSnapshotMap(snapshots, "datastore_mutation", {
        allowEmpty: false,
        mergeWithExisting: true,
      })
    }

    dataStore.on("set", handleMutation)
    dataStore.on("update", handleMutation)
    dataStore.on("delete", handleMutation)

    return () => {
      dataStore.off("set", handleMutation)
      dataStore.off("update", handleMutation)
      dataStore.off("delete", handleMutation)
    }
  }, [
    collectPanelSnapshotsFromDataStore,
    emitDebugLog,
    getWorkspaceDataStore,
    updatePanelSnapshotMap,
    currentWorkspaceId,
    replayingWorkspaceRef,
  ])

  const waitForPanelSnapshotReadiness = useCallback(
    async (reason: string, maxWaitMs = 800, workspaceOverride?: string | null): Promise<boolean> => {
      if (!featureEnabled || !v2Enabled) return true
      const workspaceId =
        workspaceOverride ??
        snapshotOwnerWorkspaceIdRef.current ??
        currentWorkspaceIdRef.current ??
        currentWorkspaceId
      if (!workspaceId) return true
      if (replayingWorkspaceRef.current > 0) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "snapshot_wait_replay",
          metadata: {
            workspaceId,
            pendingReplays: replayingWorkspaceRef.current,
            reason,
          },
        })
        const replaySettled = await new Promise<boolean>((resolve) => {
          const start = Date.now()
          const check = () => {
            if (replayingWorkspaceRef.current === 0) {
              resolve(true)
              return
            }
            if (Date.now() - start >= maxWaitMs) {
              resolve(false)
              return
            }
            setTimeout(check, 16)
          }
          check()
        })
        emitDebugLog({
          component: "NoteWorkspace",
          action: replaySettled ? "snapshot_replay_resolved" : "snapshot_replay_timeout",
          metadata: {
            workspaceId,
            pendingReplays: replayingWorkspaceRef.current,
            reason,
          },
        })
        if (!replaySettled) {
          return false
        }
      }
      const pendingCount = getPendingPanelCount(workspaceId)
      const lastPendingAt = lastPendingTimestampRef.current.get(workspaceId) ?? 0
      const hasRecentPending = lastPendingAt > 0 && Date.now() - lastPendingAt < maxWaitMs
      const waitReason =
        pendingCount > 0 ? "pending_panels" : hasRecentPending ? "recent_pending" : "none"
      emitDebugLog({
        component: "NoteWorkspace",
        action: "snapshot_wait_pending_panels",
        metadata: {
          workspaceId,
          pendingCount,
          reason,
          waitReason,
          lastPendingMs: lastPendingAt ? Date.now() - lastPendingAt : null,
        },
      })
      if (waitReason === "none") {
        return true
      }
      // If we just saw pending activity, require a short stability window before capturing.
      if (waitReason === "recent_pending") {
        const stabilityMs = Math.min(200, maxWaitMs)
        const stable = await new Promise<boolean>((resolve) => {
          const start = Date.now()
          const check = () => {
            const elapsed = Date.now() - start
            const stillPending = getPendingPanelCount(workspaceId)
            if (stillPending === 0 && elapsed >= stabilityMs) {
              resolve(true)
              return
            }
            if (elapsed >= maxWaitMs) {
              resolve(false)
              return
            }
            setTimeout(check, 16)
          }
          check()
        })
        if (!stable) {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "snapshot_pending_timeout",
          metadata: {
            workspaceId,
            reason,
            pendingCount,
            lastPendingMs: lastPendingAt ? Date.now() - lastPendingAt : null,
          },
        })
          return false
        }
      }
      const ready = await Promise.race<boolean>([
        waitForWorkspaceSnapshotReady(workspaceId, maxWaitMs),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), maxWaitMs)),
      ])
      emitDebugLog({
        component: "NoteWorkspace",
        action: ready ? "snapshot_pending_resolved" : "snapshot_pending_timeout",
        metadata: {
          workspaceId,
          pendingCount: getPendingPanelCount(workspaceId),
          reason,
          waitReason,
        },
      })
      return ready
    },
    [currentWorkspaceId, emitDebugLog, featureEnabled, v2Enabled, waitForWorkspaceSnapshotReady],
  )
  END OF EXTRACTED PANEL SNAPSHOT FUNCTIONS (collectPanelSnapshotsFromDataStore, getAllPanelSnapshots, updatePanelSnapshotMap, useEffect dataStore, waitForPanelSnapshotReadiness) */

  /* EXTRACTED TO use-workspace-snapshot.ts
  const applyPanelSnapshots = useCallback(
    (
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
    ) => {
      const replayStartedAt = Date.now()
      const allowEmptyApply = options?.allowEmptyApply ?? false
      const shouldClearWorkspace = options?.clearWorkspace ?? false
      const suppressMutations = options?.suppressMutationEvents ?? true
      const shouldClearComponentsExplicit = options?.clearComponents ?? false
      const applyReason = options?.reason ?? "apply_panel_snapshots"
      let releasingReplay = false
      if (suppressMutations) {
        replayingWorkspaceRef.current += 1
        releasingReplay = true
      }
      try {
        const hasPanelPayload = Boolean(panels && panels.length > 0)
        const hasComponentPayload = Array.isArray(components)
        const hasAnyComponentRecords = Boolean(components && components.length > 0)
        if (!hasPanelPayload && !hasAnyComponentRecords && !allowEmptyApply && !shouldClearWorkspace) return
        const activeWorkspaceId =
          snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
        const dataStore = getWorkspaceDataStore(activeWorkspaceId)
        const layerMgr = getWorkspaceLayerManager(activeWorkspaceId)
        if (!dataStore) return
        const runtimeState =
          !liveStateEnabled || !activeWorkspaceId
            ? "legacy"
            : hasWorkspaceRuntime(activeWorkspaceId)
              ? "hot"
              : "cold"

        const normalizedTargetIds = new Set<string>(targetNoteIds)
        const workspaceMembership = getWorkspaceNoteMembership(activeWorkspaceId)
        const membershipKnown = workspaceMembership !== null && workspaceMembership !== undefined
        if (v2Enabled && !membershipKnown) {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "panel_snapshot_skip_membership_unknown",
            metadata: {
              workspaceId: activeWorkspaceId,
              reason: applyReason,
            },
          })
          return
        }
        const allowedNoteIds = workspaceMembership ? new Set<string>(workspaceMembership) : null
        if (allowedNoteIds) {
          normalizedTargetIds.forEach((noteId) => {
            if (noteId) {
              allowedNoteIds.add(noteId)
            }
          })
        }
        panels?.forEach((panel) => {
          if (!panel.noteId) return
          normalizedTargetIds.add(panel.noteId)
        })

        // DEBUG: Log membership state before pruning loop
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_apply_membership_state",
          metadata: {
            workspaceId: activeWorkspaceId,
            reason: applyReason,
            runtimeState,
            workspaceMembershipSize: workspaceMembership?.size ?? null,
            workspaceMembershipIds: workspaceMembership ? Array.from(workspaceMembership) : null,
            allowedNoteIdsSize: allowedNoteIds?.size ?? null,
            allowedNoteIds: allowedNoteIds ? Array.from(allowedNoteIds) : null,
            normalizedTargetIdsSize: normalizedTargetIds.size,
            normalizedTargetIds: Array.from(normalizedTargetIds),
            panelCount: panels?.length ?? 0,
          },
        })

        const shouldTargetAllNotes = normalizedTargetIds.size === 0
        const shouldLimitToAllowed = Boolean(allowedNoteIds)
        const keysToRemove: string[] = []
        if (typeof dataStore.keys === "function") {
          for (const key of dataStore.keys() as Iterable<string>) {
            const rawKey = String(key)
            const parsed = parsePanelKey(rawKey)
            if (!parsed?.noteId || !parsed?.panelId) continue
            let removeKey = false
            const belongsToWorkspace =
              !shouldLimitToAllowed || allowedNoteIds?.has(parsed.noteId) || normalizedTargetIds.has(parsed.noteId)
            // FIX 3: Respect preserved membership when determining if panel is targeted
            // Panels belonging to workspace via membership should not be pruned even if not in snapshot
            const isTargeted = shouldTargetAllNotes ||
                               normalizedTargetIds.has(parsed.noteId) ||
                               (allowedNoteIds?.has(parsed.noteId) ?? false)
            if (shouldClearWorkspace) {
              removeKey = true
            } else if (!belongsToWorkspace) {
              removeKey = true
            } else if (!isTargeted) {
              removeKey = true
            }
            if (removeKey) {
              keysToRemove.push(rawKey)
              // DEBUG: Log why this panel is being removed
              emitDebugLog({
                component: "NoteWorkspace",
                action: "panel_snapshot_prune_decision",
                metadata: {
                  workspaceId: activeWorkspaceId,
                  panelKey: rawKey,
                  noteId: parsed.noteId,
                  panelId: parsed.panelId,
                  reason: applyReason,
                  shouldClearWorkspace,
                  belongsToWorkspace,
                  isTargeted,
                  inAllowedNoteIds: allowedNoteIds?.has(parsed.noteId) ?? null,
                  inNormalizedTargetIds: normalizedTargetIds.has(parsed.noteId),
                  shouldTargetAllNotes,
                  shouldLimitToAllowed,
                  removalReason: shouldClearWorkspace ? "clearWorkspace" : !belongsToWorkspace ? "notBelongsToWorkspace" : "notTargeted",
                },
              })
            }
          }
        }

        panels?.forEach((panel) => {
          if (!panel.noteId || !panel.panelId) return
          const shouldApplyPanel = shouldTargetAllNotes || normalizedTargetIds.has(panel.noteId)
          if (!shouldApplyPanel) return
          const key = ensurePanelKey(panel.noteId, panel.panelId)
          dataStore.set(key, {
            id: panel.panelId,
            type: panel.type ?? "note",
            position: panel.position ?? panel.worldPosition ?? null,
            dimensions: panel.size ?? panel.worldSize ?? null,
            zIndex: panel.zIndex ?? undefined,
            title: panel.title ?? undefined,
            metadata: panel.metadata ?? undefined,
            parentId: panel.parentId ?? null,
            branches: panel.branches ?? [],
            worldPosition: panel.worldPosition ?? panel.position ?? null,
            worldSize: panel.worldSize ?? panel.size ?? null,
          })
        })

        if (keysToRemove.length > 0) {
          keysToRemove.forEach((key) => {
            dataStore.delete(key)
          })
          emitDebugLog({
            component: "NoteWorkspace",
            action: shouldClearWorkspace ? "panel_snapshot_apply_clear" : "panel_snapshot_apply_prune",
            metadata: {
              workspaceId: activeWorkspaceId,
              clearedCount: keysToRemove.length,
              clearedAll: shouldClearWorkspace && keysToRemove.length > 0,
            },
          })
        }

        if (!hasPanelPayload && !allowEmptyApply && !shouldClearWorkspace) {
          // nothing else to do for panels
        }
        if (layerMgr) {
          const existingComponentNodes =
            typeof layerMgr.getNodes === "function"
              ? Array.from(layerMgr.getNodes().values()).filter((node: any) => node.type === "component")
              : []
          if (components && components.length > 0) {
            const incomingIds = new Set<string>()
            components.forEach((component) => {
              if (!component.id || !component.type) return
              incomingIds.add(component.id)
              const componentMetadata = {
                ...(component.metadata ?? {}),
              } as Record<string, unknown> & { componentType?: string }
              const hasComponentType =
                typeof componentMetadata.componentType === "string" && componentMetadata.componentType.length > 0
              if (!hasComponentType) {
                componentMetadata.componentType = component.type
              }
              layerMgr.registerNode({
                id: component.id,
                type: "component",
                position: component.position ?? { x: 0, y: 0 },
                dimensions: component.size ?? undefined,
                zIndex: component.zIndex ?? undefined,
                metadata: componentMetadata,
              } as any)
            })
            existingComponentNodes
              .filter((node: any) => !incomingIds.has(node.id))
              .forEach((node: any) => {
                if (shouldClearComponentsExplicit || shouldClearWorkspace) {
                  layerMgr.removeNode(node.id)
                }
              })
            emitDebugLog({
              component: "NoteWorkspace",
              action: "component_snapshot_apply",
              metadata: {
                workspaceId: activeWorkspaceId,
                incomingCount: components.length,
                removedCount:
                  shouldClearComponentsExplicit || shouldClearWorkspace
                    ? existingComponentNodes.filter((node: any) => !incomingIds.has(node.id)).length
                    : 0,
              },
            })
          } else if (shouldClearComponentsExplicit || shouldClearWorkspace) {
            existingComponentNodes.forEach((node: any) => layerMgr.removeNode(node.id))
            emitDebugLog({
              component: "NoteWorkspace",
              action: "component_snapshot_apply_clear",
              metadata: {
                workspaceId: activeWorkspaceId,
                clearedCount: existingComponentNodes.length,
                allowEmpty: allowEmptyApply,
              },
            })
          }
        }
        emitDebugLog({
          component: "NoteWorkspace",
          action: "workspace_snapshot_replay",
          metadata: {
            workspaceId: activeWorkspaceId,
            reason: applyReason,
            panelCount: panels?.length ?? 0,
            componentCount: Array.isArray(components) ? components.length : 0,
            targetNoteCount: normalizedTargetIds.size,
            clearedCount: keysToRemove.length,
            clearedWorkspace: shouldClearWorkspace,
            suppressedMutations: suppressMutations,
            durationMs: Date.now() - replayStartedAt,
            runtimeState,
          },
        })
        if (panels) {
          lastPanelSnapshotHashRef.current = serializePanelSnapshots(panels)
        } else if (allowEmptyApply || shouldClearWorkspace) {
          lastPanelSnapshotHashRef.current = serializePanelSnapshots([])
        }
      } finally {
        if (releasingReplay) {
          replayingWorkspaceRef.current = Math.max(0, replayingWorkspaceRef.current - 1)
        }
      }
    },
    [
      sharedWorkspace,
      layerContext,
      v2Enabled,
      currentWorkspaceId,
      emitDebugLog,
      getWorkspaceNoteMembership,
      hasWorkspaceRuntime,
      liveStateEnabled,
    ],
  )

  const captureCurrentWorkspaceSnapshot = useCallback(
    async (
      targetWorkspaceId?: string | null,
      options?: { readinessReason?: string; readinessMaxWaitMs?: number; skipReadiness?: boolean },
    ) => {
      const workspaceId =
        targetWorkspaceId ??
        snapshotOwnerWorkspaceIdRef.current ??
        currentWorkspaceId ??
        currentWorkspaceIdRef.current
      if (!workspaceId) return
      const readinessReason = options?.readinessReason ?? "capture_snapshot"
      const readinessMaxWaitMs = options?.readinessMaxWaitMs ?? 800
      if (!options?.skipReadiness) {
        const ready = await waitForPanelSnapshotReadiness(readinessReason, readinessMaxWaitMs, workspaceId)
        if (!ready) {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "snapshot_capture_skipped_pending",
            metadata: {
              workspaceId,
              reason: readinessReason,
            },
          })
          return
        }
      }
      // FIX: Use runtime as the SOLE source of truth for open notes.
      // Previously, this code merged provider openNotes with runtime, which caused cross-workspace
      // contamination when the provider hadn't switched yet during workspace transitions.
      // Now we read ONLY from the per-workspace runtime ledger (like components do).
      let workspaceOpenNotes = getWorkspaceOpenNotes(workspaceId)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "snapshot_open_notes_source",
        metadata: {
          workspaceId,
          runtimeCount: workspaceOpenNotes.length,
          noteIds: workspaceOpenNotes.map(n => n.noteId),
          source: "runtime_only",
        },
      })
      let openNoteIds = new Set(
        workspaceOpenNotes
          .map((entry) => entry.noteId)
          .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
      )
      if (liveStateEnabled) {
        const cachedPanels = workspaceSnapshotsRef.current.get(workspaceId)?.panels ?? []
        if (cachedPanels.length > 0) {
          const cachedNoteIds = new Set(
            cachedPanels
              .map((panel) => panel.noteId)
              .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
          )
          const missingCachedNotes = Array.from(cachedNoteIds).filter((noteId) => !openNoteIds.has(noteId))
          if (missingCachedNotes.length > 0) {
            // FIX 4: Prevent infinite deferral loop from stale cached snapshots
            // Check if this is genuinely waiting for new notes or just stale cache
            const currentMembership = getRuntimeMembership(workspaceId)
            const allMissingAreInMembership = missingCachedNotes.every(
              (noteId) => currentMembership?.has(noteId) ?? false
            )

            if (allMissingAreInMembership && currentMembership && currentMembership.size >= cachedNoteIds.size) {
              // Cache is stale - membership already expanded beyond cached snapshot, don't defer
              emitDebugLog({
                component: "NoteWorkspace",
                action: "snapshot_capture_skip_stale_cache",
                metadata: {
                  workspaceId,
                  missingNoteIds: missingCachedNotes,
                  cachedNoteCount: cachedNoteIds.size,
                  openNoteCount: openNoteIds.size,
                  membershipCount: currentMembership.size,
                  reason: "cached_snapshot_stale_vs_membership",
                },
              })
              // Continue with capture using current state, not stale cache
            } else {
              // Loop breaker: Check if we've exceeded max deferred capture attempts
              // This prevents infinite loops when runtime is empty but cache has stale data
              const deferredCount = deferredCachedCaptureCountRef.current.get(workspaceId) ?? 0
              if (deferredCount >= MAX_DEFERRED_CACHED_CAPTURES) {
                emitDebugLog({
                  component: "NoteWorkspace",
                  action: "snapshot_deferred_capture_loop_breaker",
                  metadata: {
                    workspaceId,
                    deferredCount,
                    missingNoteIds: missingCachedNotes,
                    cachedNoteCount: cachedNoteIds.size,
                    openNoteCount: openNoteIds.size,
                    reason: "max_deferred_retries_exceeded",
                  },
                })
                // Stop the loop by not scheduling another retry, but DO NOT delete the cache!
                // The cache contains the last known good state and is needed by other code paths
                // (e.g., pre-eviction persist) as a fallback. Deleting it causes data loss.
                deferredCachedCaptureCountRef.current.delete(workspaceId)
                // Return early - don't capture with empty state, let pre-eviction or other
                // paths use the cached snapshot when they need to persist
                return
              } else {
                // Legitimate wait for notes to be added to open list
                deferredCachedCaptureCountRef.current.set(workspaceId, deferredCount + 1)
                emitDebugLog({
                  component: "NoteWorkspace",
                  action: "snapshot_capture_deferred_cached_open_notes",
                  metadata: {
                    workspaceId,
                    missingNoteIds: missingCachedNotes,
                    cachedNoteCount: cachedNoteIds.size,
                    openNoteCount: openNoteIds.size,
                    deferredAttempt: deferredCount + 1,
                    timestampMs: Date.now(),
                  },
                })
                setTimeout(() => {
                  captureCurrentWorkspaceSnapshot(workspaceId, {
                    readinessReason: "deferred_cached_open_notes",
                    readinessMaxWaitMs,
                  })
                }, CAPTURE_DEFER_DELAY_MS)
                return
              }
            }
          }
        }
      }
      // Reset deferred capture counter when we successfully proceed to capture
      // This indicates the workspace is in a healthy state
      if (workspaceId) {
        deferredCachedCaptureCountRef.current.delete(workspaceId)
      }
      const captureStartedAt = Date.now()
      emitDebugLog({
        component: "NoteWorkspace",
        action: "snapshot_capture_start",
        metadata: {
          workspaceId,
          openNoteCount: workspaceOpenNotes.length,
          activeNoteId,
          timestampMs: captureStartedAt,
        },
      })
      const previousOwner = snapshotOwnerWorkspaceIdRef.current
      snapshotOwnerWorkspaceIdRef.current = workspaceId
      const snapshots = collectPanelSnapshotsFromDataStore()
      if (workspaceId) {
        const inferredNotes = inferredWorkspaceNotesRef.current.get(workspaceId)
        if (inferredNotes && inferredNotes.size > 0) {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "panel_snapshot_inferred_membership",
            metadata: {
              workspaceId,
              inferredNoteIds: Array.from(inferredNotes),
            },
          })
          inferredWorkspaceNotesRef.current.delete(workspaceId)
        }
      }
      const observedNoteIds = new Set(
        snapshots
          .map((panel) => panel.noteId)
          .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
      )
      const missingOpenNotes = Array.from(observedNoteIds).filter((noteId) => !openNoteIds.has(noteId))
      // FIX 1: Guard against stale provider state in live-state hot runtime
      if (liveStateEnabled && hasWorkspaceRuntime(workspaceId) && missingOpenNotes.length > 0) {
        const currentAttempts = captureRetryAttemptsRef.current.get(workspaceId) ?? 0
        const maxRetries = 3
        const retryTimeoutMs = 100
        if (currentAttempts < maxRetries) {
          captureRetryAttemptsRef.current.set(workspaceId, currentAttempts + 1)
          emitDebugLog({
            component: "NoteWorkspace",
            action: "snapshot_capture_deferred_runtime_sync",
            metadata: {
              workspaceId,
              missingNoteIds: missingOpenNotes,
              panelNoteCount: observedNoteIds.size,
              openNoteCount: openNoteIds.size,
              attemptNumber: currentAttempts + 1,
              maxRetries,
              reason: readinessReason,
            },
          })
          setTimeout(() => {
            captureCurrentWorkspaceSnapshot(workspaceId, {
              readinessReason: "deferred_runtime_sync",
              readinessMaxWaitMs,
            })
          }, retryTimeoutMs)
          return
        } else {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "snapshot_capture_runtime_sync_timeout",
            metadata: {
              workspaceId,
              missingNoteIds: missingOpenNotes,
              attemptsExhausted: currentAttempts,
              proceedingWithRuntimeState: true,
            },
          })
          captureRetryAttemptsRef.current.delete(workspaceId)
        }
      } else if (missingOpenNotes.length === 0) {
        captureRetryAttemptsRef.current.delete(workspaceId)
      }
      if (missingOpenNotes.length > 0) {
        const augmentedSlots = [
          ...workspaceOpenNotes,
          ...missingOpenNotes.map((noteId) => ({
            noteId,
            mainPosition: resolveMainPanelPosition(noteId) ?? null,
          })),
        ]
        workspaceOpenNotes = commitWorkspaceOpenNotes(workspaceId, augmentedSlots, { callSite: "snapshotOpenNoteSeed" })
        openNoteIds = new Set(
          workspaceOpenNotes
            .map((entry) => entry.noteId)
            .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
        )
        emitDebugLog({
          component: "NoteWorkspace",
          action: "snapshot_open_note_seed",
          metadata: {
            workspaceId,
            addedNoteIds: missingOpenNotes,
            observedNoteCount: observedNoteIds.size,
          },
        })
      }
      pruneWorkspaceEntries(workspaceId, observedNoteIds, "capture_snapshot")
      const fallbackPanels = getLastNonEmptySnapshot(
        workspaceId,
        lastNonEmptySnapshotsRef.current,
        workspaceSnapshotsRef.current,
      )
      const mergedPanels = mergePanelSnapshots(fallbackPanels, snapshots)
      if (fallbackPanels.length > 0 && snapshots.length > 0 && mergedPanels.length > snapshots.length) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_merge_fallback",
          metadata: {
            workspaceId,
            snapshotCount: snapshots.length,
            mergedCount: mergedPanels.length,
          },
        })
      }
      const snapshotsToCache = mergedPanels.length > 0 ? mergedPanels : []
      updatePanelSnapshotMap(snapshotsToCache, "workspace_switch_capture", { allowEmpty: false })
      const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, workspaceId)
      cache.panels = snapshotsToCache
      if (snapshotsToCache.length > 0) {
        lastNonEmptySnapshotsRef.current.set(workspaceId, snapshotsToCache)
      }
      lastPanelSnapshotHashRef.current = serializePanelSnapshots(snapshotsToCache)
      const membershipSource = new Set<string>()
      workspaceOpenNotes.forEach((entry) => {
        if (entry.noteId) {
          membershipSource.add(entry.noteId)
        }
      })
      observedNoteIds.forEach((noteId) => membershipSource.add(noteId))

      // DEBUG: Log membership being set from capture
      emitDebugLog({
        component: "NoteWorkspace",
        action: "capture_set_membership_from_observed",
        metadata: {
          workspaceId,
          membershipSourceIds: Array.from(membershipSource),
          membershipSourceSize: membershipSource.size,
          workspaceOpenNotesCount: workspaceOpenNotes.length,
          observedNoteIdsCount: observedNoteIds.size,
        },
      })

      setWorkspaceNoteMembership(workspaceId, membershipSource)
      const workspaceIdForComponents = workspaceId
      const lm = workspaceIdForComponents ? getWorkspaceLayerManager(workspaceIdForComponents) : null
      const componentsFromManager: NoteWorkspaceComponentSnapshot[] =
        lm && typeof lm.getNodes === "function"
          ? Array.from(lm.getNodes().values())
              .filter((node: any) => node.type === "component")
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
          : []

      const cachedSnapshot = workspaceId ? getWorkspaceSnapshot(workspaceId) : null
      const lastComponents = workspaceId ? lastComponentsSnapshotRef.current.get(workspaceId) ?? [] : []
      const componentSource =
        componentsFromManager.length > 0 ? componentsFromManager : cachedSnapshot?.components ?? lastComponents
      const components: NoteWorkspaceComponentSnapshot[] = mergeComponentSnapshots(
        componentSource,
        cachedSnapshot?.components ?? [],
        lastComponents
      )
    if (v2Enabled) {
      if (components.length > 0 && workspaceId) {
        lastComponentsSnapshotRef.current.set(workspaceId, components)
      }
      cache.components = components
      const normalizedOpenNotes = workspaceOpenNotes.map((note) => ({
        noteId: note.noteId,
        mainPosition: resolveMainPanelPosition(note.noteId),
      }))
      cache.openNotes = normalizedOpenNotes
      commitWorkspaceOpenNotes(workspaceId, normalizedOpenNotes, { callSite: "captureSnapshot" })
      cacheWorkspaceSnapshot({
        workspaceId,
        panels: snapshots,
        components,
        openNotes: normalizedOpenNotes,
        camera: canvasState
          ? {
              x: canvasState.translateX,
              y: canvasState.translateY,
              scale: canvasState.zoom,
            }
          : layerContext?.transforms.notes ?? DEFAULT_CAMERA,
        activeNoteId,
      })
      lastPreviewedSnapshotRef.current.delete(workspaceId)
    }
    snapshotOwnerWorkspaceIdRef.current = previousOwner ?? workspaceId
    const cameraSource = canvasState
      ? "canvas_state"
      : layerContext?.transforms.notes
        ? "layer_transform"
        : "default_camera"
    emitDebugLog({
      component: "NoteWorkspace",
      action: "snapshot_capture_complete",
      metadata: {
        workspaceId,
        panelCount: snapshots.length,
        openNoteCount: workspaceOpenNotes.length,
        componentCount: components?.length ?? 0,
        durationMs: Date.now() - captureStartedAt,
        cameraSource,
        timestampMs: Date.now(),
      },
    })
      if (targetWorkspaceId) {
        snapshotOwnerWorkspaceIdRef.current = previousOwner
      } else {
        snapshotOwnerWorkspaceIdRef.current = previousOwner ?? workspaceId
      }
    },
    [
      activeNoteId,
      canvasState,
      collectPanelSnapshotsFromDataStore,
      commitWorkspaceOpenNotes,
      currentWorkspaceId,
      emitDebugLog,
      getWorkspaceOpenNotes,
      layerContext?.transforms.notes,
      pruneWorkspaceEntries,
      resolveMainPanelPosition,
      updatePanelSnapshotMap,
      setWorkspaceNoteMembership,
      waitForPanelSnapshotReadiness,
      liveStateEnabled,
      v2Enabled,
    ],
  )
  END OF EXTRACTED (applyPanelSnapshots, captureCurrentWorkspaceSnapshot) */

  // Keep captureSnapshotRef updated with the latest version
  captureSnapshotRef.current = captureCurrentWorkspaceSnapshot

  /* EXTRACTED TO use-workspace-snapshot.ts (buildPayloadFromSnapshot)
  const buildPayloadFromSnapshot = useCallback(
    (workspaceId: string, snapshot: NoteWorkspaceSnapshot): NoteWorkspacePayload => {
      const normalizedOpenNotes = snapshot.openNotes.map((entry) => ({
        noteId: entry.noteId,
        position: entry.mainPosition ?? null,
      }))
      const active = snapshot.activeNoteId ?? normalizedOpenNotes[0]?.noteId ?? null

      // FIX: Fallback to cached components if snapshot has none but we had components before.
      let components = snapshot.components ?? []
      if (components.length === 0) {
        const cachedComponents = lastComponentsSnapshotRef.current.get(workspaceId)
        if (cachedComponents && cachedComponents.length > 0) {
          components = cachedComponents
        }
      }

      const payload: NoteWorkspacePayload = {
        schemaVersion: "1.1.0",
        openNotes: normalizedOpenNotes,
        activeNoteId: active,
        camera: snapshot.camera ?? DEFAULT_CAMERA,
        panels: snapshot.panels ?? [],
      }
      if (components.length > 0) {
        payload.components = components
      }
      return payload
    },
    [],
  )
  END OF EXTRACTED (buildPayloadFromSnapshot) */

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

  /* EXTRACTED TO use-workspace-snapshot.ts (rehydratePanelsForNote, previewWorkspaceFromSnapshot)
  const rehydratePanelsForNote = useCallback(
    (noteId: string, workspaceId?: string) => {
      if (workspaceId && workspaceSnapshotsRef.current.has(workspaceId)) {
        const perWorkspace = (workspaceSnapshotsRef.current.get(workspaceId)?.panels ?? []).filter(
          (panel) => panel.noteId === noteId,
        )
        if (perWorkspace.length > 0) {
          applyPanelSnapshots(perWorkspace, new Set([noteId]), undefined, { reason: "rehydrate_note" })
          return
        }
      }
      const stored = panelSnapshotsRef.current.get(noteId)
      if (!stored || stored.length === 0) return
      applyPanelSnapshots(stored, new Set([noteId]), undefined, { reason: "rehydrate_note" })
    },
    [applyPanelSnapshots],
  )

  const previewWorkspaceFromSnapshot = useCallback(
    async (workspaceId: string, snapshot: NoteWorkspaceSnapshot, options?: { force?: boolean }) => {
      const force = options?.force ?? false
      if (liveStateEnabled) {
        await ensureRuntimePrepared(workspaceId, "preview_snapshot")
      }
      const lastPreview = lastPreviewedSnapshotRef.current.get(workspaceId)
      if (!force && lastPreview === snapshot) {
        return
      }

      // FIX 8: Don't apply empty snapshot if runtime has notes
      // This protects against stale/transitional snapshots overwriting live state
      const snapshotOpenNotesCount = snapshot.openNotes?.length ?? 0
      if (snapshotOpenNotesCount === 0 && liveStateEnabled && hasWorkspaceRuntime(workspaceId)) {
        const runtimeOpenNotes = getRuntimeOpenNotes(workspaceId)
        if (runtimeOpenNotes && runtimeOpenNotes.length > 0) {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "fix8_rejected_empty_snapshot",
            metadata: {
              workspaceId,
              runtimeNoteCount: runtimeOpenNotes.length,
              reason: "runtime_has_notes_would_lose_data",
            },
          })
          return // Don't apply - would lose notes
      }
      }

      snapshotOwnerWorkspaceIdRef.current = workspaceId
      const panelSnapshots = snapshot.panels ?? []
      const declaredNoteIds = new Set(
        snapshot.openNotes.map((entry) => entry.noteId).filter((noteId): noteId is string => Boolean(noteId)),
      )
      if (declaredNoteIds.size === 0) {
        panelSnapshots.forEach((panel) => {
          if (panel.noteId) {
            declaredNoteIds.add(panel.noteId)
          }
        })
      }
      // FIX 2: Prevent membership regression from partial snapshots in hot runtimes
      const runtimeState = liveStateEnabled && hasWorkspaceRuntime(workspaceId) ? "hot" : "cold"

      // FIX 9: Skip snapshot replay entirely for hot runtimes
      // Hot runtimes maintain their own state - the canvas was just hidden via CSS, not unmounted.
      // All panels, components, and notes are still there. Replaying the snapshot would:
      // 1. Set workspaceRestorationInProgress flag causing canvas to skip sync
      // 2. Potentially overwrite live state with stale snapshot data
      // 3. Cause the canvas to appear empty during the restoration window
      // For hot runtimes, we just need visibility toggle - no state changes needed.
      // IMPORTANT: Do NOT call bumpSnapshotRevision() here - it triggers the canvas's internal
      // restoration logic which sets workspaceRestorationInProgress=true and skips component rendering.
      if (runtimeState === "hot") {
        // Phase 1 Unification: Check runtime ledger first (authoritative source)
        const runtimeLedgerCount = getRuntimeComponentCount(workspaceId)
        const runtimeComponentCount = getRegisteredComponentCount(workspaceId)

        // FIX 6 + Phase 1 Unification: When hot runtime has components in ledger but React hasn't
        // mounted them yet, OR when ledger is empty but snapshot has components, restore them.
        if (snapshot.components && snapshot.components.length > 0) {
          // Always populate runtime ledger from snapshot (ensures data is in authoritative source)
          if (runtimeLedgerCount === 0) {
            populateRuntimeComponents(workspaceId, snapshot.components)
          }

          // If React components aren't registered yet, also register to LayerManager for rendering
          if (runtimeComponentCount === 0) {
            const layerMgr = getWorkspaceLayerManager(workspaceId)
            if (layerMgr) {
              snapshot.components.forEach((component) => {
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
                action: "preview_hot_runtime_component_restore",
                metadata: {
                  workspaceId,
                  componentCount: snapshot.components.length,
                  runtimeLedgerCount,
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
          action: "preview_snapshot_skip_hot_runtime",
          metadata: {
            workspaceId,
            reason: "Hot runtime maintains own state, skip snapshot replay",
            openNotesInSnapshot: snapshot.openNotes?.length ?? 0,
            panelsInSnapshot: snapshot.panels?.length ?? 0,
            runtimeComponentCount,
            componentsInSnapshot: snapshot.components?.length ?? 0,
          },
        })
        lastPreviewedSnapshotRef.current.set(workspaceId, snapshot)
        return
      }

      // Cold runtime: snapshot is authoritative (hot runtimes already returned via FIX 9)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "preview_set_membership_branch",
        metadata: { workspaceId, branch: "cold_runtime", noteCount: declaredNoteIds.size },
      })
      setWorkspaceNoteMembership(workspaceId, declaredNoteIds)
      const scopedPanels = filterPanelsForWorkspace(workspaceId, panelSnapshots)
      const targetIds = new Set<string>(declaredNoteIds)
      scopedPanels.forEach((panel) => {
        if (panel.noteId) {
          targetIds.add(panel.noteId)
        }
      })
      const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, workspaceId)
      cache.panels = scopedPanels
      cache.components = Array.isArray(snapshot.components) ? [...snapshot.components] : []

      // Phase 1 Unification: Populate runtime component ledger for cold runtimes
      if (snapshot.components && snapshot.components.length > 0) {
        populateRuntimeComponents(workspaceId, snapshot.components)
      }

      const normalizedOpenNotes = snapshot.openNotes.map((entry) => ({
        noteId: entry.noteId,
        mainPosition: entry.mainPosition ?? null,
      }))

      // Cold runtime: use snapshot openNotes directly (hot runtimes already returned via FIX 9)
      const openNotesToCommit = normalizedOpenNotes
      cache.openNotes = openNotesToCommit

      // FIX 5: Prevent commitWorkspaceOpenNotes from overwriting Fix 2's merged membership
      // The membership was already set correctly by Fix 2 above (lines 2080-2112)
      // We only want to update the open notes cache/runtime, not the membership
      commitWorkspaceOpenNotes(workspaceId, openNotesToCommit, { updateMembership: false, callSite: "replaySnapshot" })
      updatePanelSnapshotMap(scopedPanels, "preview_snapshot", { allowEmpty: true })
      const panelNoteIds = new Set(scopedPanels.map((panel) => panel.noteId).filter(Boolean) as string[])
      panelNoteIds.forEach((id) => targetIds.add(id))
      applyPanelSnapshots(scopedPanels, panelNoteIds, snapshot.components, {
        allowEmptyApply: true,
        suppressMutationEvents: true,
        reason: "preview_snapshot",
      })

      // Extend targetIds with openNotes for close loop reconciliation
      openNotesToCommit.forEach(n => targetIds.add(n.noteId))

      // Close loop for cold runtimes: close notes not in the target snapshot
      // (Hot runtimes skip this entirely via FIX 9 early return above)
      const currentOpenIds = new Set(openNotes.map((note) => note.noteId))
      const notesToClose = openNotes.filter((note) => !targetIds.has(note.noteId))
      await Promise.all(
        notesToClose.map((note) =>
          closeWorkspaceNote(note.noteId, { persist: false, removeWorkspace: false }).catch(() => {}),
        ),
      )
      notesToClose.forEach((note) => currentOpenIds.delete(note.noteId))

      for (const entry of snapshot.openNotes) {
        if (currentOpenIds.has(entry.noteId)) continue
        await openWorkspaceNote(entry.noteId, {
          mainPosition: entry.mainPosition ?? undefined,
          persist: false,
          persistPosition: false,
          workspaceId,
        })
        currentOpenIds.add(entry.noteId)
      }

      const nextActive = snapshot.activeNoteId || snapshot.openNotes[0]?.noteId || null
      setActiveNoteId(nextActive)

      const nextCamera = snapshot.camera ?? DEFAULT_CAMERA
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

      lastPreviewedSnapshotRef.current.set(workspaceId, snapshot)

      // FIX: Set save cooldown after replay to prevent race condition (same as hydrate).
      skipSavesUntilRef.current.set(workspaceId, Date.now() + 500)

      emitDebugLog({
        component: "NoteWorkspace",
        action: "preview_snapshot_applied",
        metadata: {
          workspaceId,
          panelCount: scopedPanels.length,
          openCount: snapshot.openNotes.length,
          componentCount: snapshot.components?.length ?? 0,
          activeNoteId: nextActive,
          saveCooldownSet: true,
        },
      })
      bumpSnapshotRevision()
    },
    [
      applyPanelSnapshots,
      bumpSnapshotRevision,
      closeWorkspaceNote,
      commitWorkspaceOpenNotes,
      ensureRuntimePrepared,
      emitDebugLog,
      filterPanelsForWorkspace,
      layerContext,
      liveStateEnabled,
      openWorkspaceNote,
      setWorkspaceNoteMembership,
      setActiveNoteId,
      setCanvasState,
    ],
  )
  END OF EXTRACTED SNAPSHOT MANAGEMENT FUNCTIONS (applyPanelSnapshots, captureCurrentWorkspaceSnapshot, buildPayloadFromSnapshot, rehydratePanelsForNote, previewWorkspaceFromSnapshot) */



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
    if (workspaceOpenNotes.length === 0 && workspaceMembership && workspaceMembership.size > 0) {
      const inferredSlots = Array.from(workspaceMembership).map((noteId) => ({
        noteId,
        mainPosition: resolveMainPanelPosition(noteId),
      }))
      workspaceOpenNotes = commitWorkspaceOpenNotes(workspaceIdForComponents, inferredSlots, {
        updateCache: false,
        callSite: "buildPayload_inferred",
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
      activeNoteId,
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
        activeNoteId,
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
    getWorkspaceLayerManager,
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
  ])

  /**
   * Persist any workspace (active or background) by ID.
   *
   * For the active workspace: uses buildPayload() which collects fresh data and caches properly.
   * For background workspaces: ensures snapshot is captured/cached before reading.
   *
   * This addresses the issue where persistWorkspaceSnapshot reads from stale cache
   * because cacheWorkspaceSnapshot() was only called for the active workspace.
   */
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
      setWorkspaceNoteMembership,
      waitForPanelSnapshotReadiness,
    ]
  )

  // Keep persistWorkspaceByIdRef updated with the latest version
  persistWorkspaceByIdRef.current = persistWorkspaceById

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
  }, [buildPayload, currentWorkspaceSummary, emitDebugLog, featureEnabled, getWorkspaceOpenNotes])

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
    persistWorkspaceNow,
    v2Enabled,
  ])

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
    [currentWorkspaceSummary, emitDebugLog, featureEnabled, persistWorkspaceById],
  )

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
    [currentWorkspaceSummaryId, emitDebugLog, persistWorkspaceById],
  )

  // Entry switch handler - flushes dirty workspaces before changing entry
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
    [emitDebugLog, flushPendingSave],
  )

  // Subscribe to external entry context changes (e.g., from Quick Links)
  useEffect(() => {
    if (!featureEnabled) return

    const unsubscribe = subscribeToActiveEntryContext((entryId) => {
      if (entryId !== currentEntryId) {
        handleEntryChange(entryId)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [featureEnabled, currentEntryId, handleEntryChange])

  const hydrateWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!adapterRef.current) return
      setIsLoading(true)
      const hydrateStart = Date.now()
      try {
        const record = await adapterRef.current.loadWorkspace(workspaceId)
        isHydratingRef.current = true
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
          // Phase 1 Unification: Populate runtime component ledger from hydrated components
          // This ensures components are available in the runtime before React renders them
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
      } finally {
        isHydratingRef.current = false
        snapshotOwnerWorkspaceIdRef.current = workspaceId
        setIsLoading(false)
      }
    },
    [
      applyPanelSnapshots,
      closeWorkspaceNote,
      commitWorkspaceOpenNotes,
      emitDebugLog,
      filterPanelsForWorkspace,
      layerContext,
      liveStateEnabled,
      openNotes,
      openWorkspaceNote,
      setActiveNoteId,
      setCanvasState,
      setWorkspaceNoteMembership,
      setIsLoading,
      setStatusHelperText,
      setWorkspaces,
      bumpSnapshotRevision,
    ],
  )

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

  const handleCreateWorkspace = useCallback(async () => {
    if (!featureEnabled || !adapterRef.current) return
    flushPendingSave("workspace_create")
    try {
      const workspace = await adapterRef.current.createWorkspace({
        payload: {
          schemaVersion: "1.1.0",
          openNotes: [],
          activeNoteId: null,
          camera: DEFAULT_CAMERA,
          panels: [],
          components: [],
        },
        // Associate new workspace with current entry context
        itemId: currentEntryId || undefined,
      })
      await ensureRuntimePrepared(workspace.id, "create_workspace")
      setWorkspaces((prev) => [...prev, workspace])
      setCurrentWorkspaceId(workspace.id)
      setWorkspaceNoteMembership(workspace.id, [])
      commitWorkspaceOpenNotes(workspace.id, [], { updateCache: false, callSite: "createWorkspace" })
      setStatusHelperText(formatSyncedLabel(workspace.updatedAt))
      emitDebugLog({
        component: "NoteWorkspace",
        action: "create_success",
        metadata: { workspaceId: workspace.id },
      })
    } catch (error) {
      console.error("[NoteWorkspace] create failed", error)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "create_error",
        metadata: { error: error instanceof Error ? error.message : String(error) },
      })
    }
  }, [
    commitWorkspaceOpenNotes,
    currentEntryId,
    emitDebugLog,
    ensureRuntimePrepared,
    featureEnabled,
    flushPendingSave,
    setWorkspaceNoteMembership,
  ])

  const handleDeleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!adapterRef.current) return
      try {
        await adapterRef.current.deleteWorkspace(workspaceId)
        setWorkspaces((prev) => prev.filter((workspace) => workspace.id !== workspaceId))
        workspaceNoteMembershipRef.current.delete(workspaceId)
        workspaceOpenNotesRef.current.delete(workspaceId)
        Array.from(ownedNotesRef.current.entries()).forEach(([noteId, ownerWorkspaceId]) => {
          if (ownerWorkspaceId === workspaceId) {
            clearNoteWorkspaceOwner(noteId)
            ownedNotesRef.current.delete(noteId)
          }
        })
        if (currentWorkspaceId === workspaceId) {
          const fallback = workspaces.find((workspace) => workspace.id !== workspaceId)
          setCurrentWorkspaceId(fallback?.id ?? null)
        }
        emitDebugLog({
          component: "NoteWorkspace",
          action: "delete_success",
          metadata: { workspaceId },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete workspace"
        console.error("[NoteWorkspace] delete failed", error)
        setStatusHelperText(message)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "delete_error",
          metadata: { workspaceId, error: message },
        })
      }
    },
    [currentWorkspaceId, emitDebugLog, workspaces],
  )

  const handleRenameWorkspace = useCallback(
    async (workspaceId: string, nextName: string) => {
      if (!adapterRef.current) return
      const workspace = workspaces.find((entry) => entry.id === workspaceId)
      if (!workspace) return
      const trimmed = nextName.trim()
      if (!trimmed) return
      try {
        const payload = buildPayload()
        const updated = await adapterRef.current.saveWorkspace({
          id: workspaceId,
          payload,
          revision: workspace.revision,
          name: trimmed,
        })
        setWorkspaces((prev) =>
          prev.map((entry) =>
            entry.id === updated.id
              ? {
                  ...entry,
                  name: updated.name,
                  revision: updated.revision,
                  updatedAt: updated.updatedAt,
                }
              : entry,
          ),
        )
        if (currentWorkspaceId === workspaceId) {
          setStatusHelperText(formatSyncedLabel(updated.updatedAt))
        }
      } catch (error) {
        console.error("[NoteWorkspace] rename failed", error)
      }
    },
    [buildPayload, currentWorkspaceId, workspaces],
  )

  const handleSelectWorkspace = useCallback(
    (workspaceId: string) => {
      if (workspaceId === currentWorkspaceId && pendingWorkspaceId === null) return
      const previousWorkspaceId = currentWorkspaceIdRef.current ?? currentWorkspaceId ?? null
      setPendingWorkspaceId(workspaceId)
      setActiveWorkspaceContext(workspaceId)

      // Phase 2: Check if target workspace has a hot runtime
      const targetRuntimeState = hasWorkspaceRuntime(workspaceId) ? "hot" : "cold"

      emitDebugLog({
        component: "NoteWorkspace",
        action: "select_workspace_requested",
        metadata: { workspaceId, previousWorkspaceId, targetRuntimeState },
      })

      // Phase 2: HOT SWITCH - Just toggle visibility, skip snapshot capture/replay
      if (liveStateEnabled && targetRuntimeState === "hot") {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "workspace_switch_hot",
          metadata: {
            workspaceId,
            previousWorkspaceId,
            hotRuntimeCount: listHotRuntimes().length,
          },
        })

        // Hide previous runtime
        if (previousWorkspaceId) {
          setRuntimeVisible(previousWorkspaceId, false)
          emitDebugLog({
            component: "NoteWorkspace",
            action: "workspace_runtime_hidden",
            metadata: { workspaceId: previousWorkspaceId },
          })
        }

        // Show target runtime
        setRuntimeVisible(workspaceId, true)

        // Phase 5: Associate workspace with current entry for cross-entry state handling
        const entryId = getActiveEntryContext()
        if (entryId) {
          setWorkspaceEntry(workspaceId, entryId)
        }

        emitDebugLog({
          component: "NoteWorkspace",
          action: "workspace_runtime_visible",
          metadata: { workspaceId, wasCold: false, entryId },
        })

        // Update state without async snapshot work
        snapshotOwnerWorkspaceIdRef.current = workspaceId
        setCurrentWorkspaceId(workspaceId)
        setPendingWorkspaceId(null)

        emitDebugLog({
          component: "NoteWorkspace",
          action: "select_workspace_hot_complete",
          metadata: { workspaceId },
        })

        return
      }

      // COLD SWITCH - Original behavior with snapshot capture/replay
      const run = async () => {
        try {
          await ensureRuntimePrepared(workspaceId, "select_workspace")
          await captureCurrentWorkspaceSnapshot(undefined, {
            readinessReason: "workspace_switch_capture",
            readinessMaxWaitMs: 1500,
          })
          lastSaveReasonRef.current = "workspace_switch"
          await persistWorkspaceNow()

          // Phase 2: Hide previous runtime after capture
          if (liveStateEnabled && previousWorkspaceId) {
            setRuntimeVisible(previousWorkspaceId, false)
            emitDebugLog({
              component: "NoteWorkspace",
              action: "workspace_runtime_hidden",
              metadata: { workspaceId: previousWorkspaceId },
            })
          }

          snapshotOwnerWorkspaceIdRef.current = workspaceId
          setActiveWorkspaceContext(workspaceId)
          setWorkspaceNoteMembership(workspaceId, [])
          const cachedSnapshot = getWorkspaceSnapshot(workspaceId)
          const cachedRevision = workspaceRevisionRef.current.get(workspaceId) ?? null
          const cachedPanels = workspaceSnapshotsRef.current.get(workspaceId)?.panels ?? null

          const applyCachedSnapshot = async () => {
            if (v2Enabled && cachedSnapshot) {
              const seedNoteIds =
                cachedSnapshot?.openNotes?.map((entry) => entry.noteId).filter((id): id is string => Boolean(id)) ?? []
              setWorkspaceNoteMembership(workspaceId, seedNoteIds)
              await previewWorkspaceFromSnapshot(workspaceId, cachedSnapshot, { force: true })
            } else if (!v2Enabled && cachedPanels && cachedPanels.length > 0) {
              const scopedPanels = filterPanelsForWorkspace(workspaceId, cachedPanels)
              setTimeout(() => {
                snapshotOwnerWorkspaceIdRef.current = workspaceId
                applyPanelSnapshots(
                  scopedPanels,
                  new Set(scopedPanels.map((panel) => panel.noteId)),
                  undefined,
                  {
                    allowEmptyApply: scopedPanels.length === 0,
                    clearWorkspace: true,
                    clearComponents: true,
                    suppressMutationEvents: true,
                    reason: "legacy_workspace_switch",
                  },
                )
              }, 0)
            }
          }

          await applyCachedSnapshot()
          setCurrentWorkspaceId(workspaceId)
          setPendingWorkspaceId(null)
          snapshotOwnerWorkspaceIdRef.current = workspaceId
          setActiveWorkspaceContext(workspaceId)
          emitDebugLog({
            component: "NoteWorkspace",
            action: "select_workspace",
            metadata: {
              workspaceId,
              hadCachedSnapshot: Boolean(cachedSnapshot),
              cachedPanelCount: cachedSnapshot?.panels.length ?? cachedPanels?.length ?? 0,
              cachedRevision,
            },
          })

          if (v2Enabled && adapterRef.current) {
            try {
              const record = await adapterRef.current.loadWorkspace(workspaceId)
              const adapterRevision = (record as any).revision ?? null
              const adapterSnapshot = {
                panels: record?.payload?.panels ?? [],
                components: record?.payload?.components ?? [],
                openNotes: record?.payload?.openNotes ?? [],
                activeNoteId: record?.payload?.activeNoteId ?? null,
                camera: record?.payload?.camera ?? DEFAULT_CAMERA,
              }
              const cachedRevisionValue = workspaceRevisionRef.current.get(workspaceId) ?? null
              const shouldApplyAdapter = !cachedSnapshot || adapterRevision !== cachedRevisionValue

              if (adapterRevision) {
                workspaceRevisionRef.current.set(workspaceId, adapterRevision)
              }

              if (shouldApplyAdapter || !cachedSnapshot) {
                await previewWorkspaceFromSnapshot(workspaceId, adapterSnapshot as any, { force: true })
              } else {
                // Replay cached snapshot even if revisions match to keep the store populated
                await previewWorkspaceFromSnapshot(workspaceId, cachedSnapshot, { force: true })
              }
            } catch (adapterError) {
              emitDebugLog({
                component: "NoteWorkspace",
                action: "adapter_load_error",
                metadata: {
                  workspaceId,
                  error: adapterError instanceof Error ? adapterError.message : String(adapterError),
                },
              })
            }
          }

          // Phase 2: Show new runtime after cold load complete
          if (liveStateEnabled) {
            setRuntimeVisible(workspaceId, true)
            emitDebugLog({
              component: "NoteWorkspace",
              action: "workspace_runtime_visible",
              metadata: { workspaceId, wasCold: true },
            })
          }
        } catch (error) {
          setPendingWorkspaceId(null)
          setActiveWorkspaceContext(previousWorkspaceId)
          emitDebugLog({
            component: "NoteWorkspace",
            action: "select_workspace_error",
            metadata: {
              workspaceId,
              error: error instanceof Error ? error.message : String(error),
            },
          })
        }
      }
      void run()
    },
    [
      applyPanelSnapshots,
      filterPanelsForWorkspace,
      captureCurrentWorkspaceSnapshot,
      currentWorkspaceId,
      ensureRuntimePrepared,
      liveStateEnabled,
      pendingWorkspaceId,
      persistWorkspaceNow,
      previewWorkspaceFromSnapshot,
      emitDebugLog,
      v2Enabled,
      adapterRef,
      workspaceRevisionRef,
      setWorkspaceNoteMembership,
    ],
  )

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
    selectWorkspace: handleSelectWorkspace,
    createWorkspace: handleCreateWorkspace,
    deleteWorkspace: handleDeleteWorkspace,
    renameWorkspace: handleRenameWorkspace,
    scheduleImmediateSave: flushPendingSave,
  }
}
