/**
 * Panel snapshot collection and management.
 * Handles reading panel states from DataStore and maintaining panel snapshot maps.
 *
 * Extracted from use-note-workspaces.ts for maintainability.
 * @see docs/proposal/refactor/use-note-workspaces/REFACTORING_PLAN.md
 */

import { useCallback, useEffect } from "react"
import type { WorkspaceRefs } from "./workspace-refs"
import type { NoteWorkspaceSlot, NoteWorkspace } from "@/lib/workspace/types"
import type { NoteWorkspacePanelSnapshot } from "@/lib/types/note-workspace"
import { SHARED_WORKSPACE_ID } from "@/lib/workspace/types"
import {
  getWorkspaceRuntime,
} from "@/lib/workspace/runtime-manager"
import { DataStore } from "@/lib/data-store"
import { getWorkspaceStore } from "@/lib/workspace/workspace-store-registry"
import { parsePanelKey } from "@/lib/canvas/composite-id"
import {
  getPendingPanelCount,
  waitForWorkspaceSnapshotReady,
} from "@/lib/note-workspaces/state"
import {
  serializePanelSnapshots,
  ensureWorkspaceSnapshotCache,
  getLastNonEmptySnapshot,
  buildPanelSnapshotFromRecord,
  mergePanelSnapshots,
} from "./workspace-utils"

// ============================================================================
// Types
// ============================================================================

export interface UseWorkspacePanelSnapshotsOptions {
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
  /** Get workspace note membership function from membership hook */
  getWorkspaceNoteMembership: (workspaceId: string | null | undefined) => Set<string> | null
  /** Current workspace ID from state */
  currentWorkspaceId: string | null
  /** Shared workspace reference */
  sharedWorkspace: NoteWorkspace | null
}

export interface UseWorkspacePanelSnapshotsResult {
  /** Filter panels to only those belonging to a workspace */
  filterPanelsForWorkspace: (
    workspaceId: string | null | undefined,
    panels: NoteWorkspacePanelSnapshot[],
  ) => NoteWorkspacePanelSnapshot[]
  /** Get runtime DataStore for a workspace */
  getRuntimeDataStore: (workspaceId: string | null | undefined) => DataStore | null
  /** Get DataStore for a workspace (runtime or registry) */
  getWorkspaceDataStore: (workspaceId: string | null | undefined) => DataStore | null
  /** Collect panel snapshots from DataStore */
  collectPanelSnapshotsFromDataStore: (targetWorkspaceId?: string | null) => NoteWorkspacePanelSnapshot[]
  /** Get all panel snapshots with fallback options */
  getAllPanelSnapshots: (options?: { useFallback?: boolean }) => NoteWorkspacePanelSnapshot[]
  /** Update the panel snapshot map */
  updatePanelSnapshotMap: (
    panels: NoteWorkspacePanelSnapshot[],
    reason: string,
    options?: { allowEmpty?: boolean; mergeWithExisting?: boolean },
  ) => void
  /** Wait for panel snapshots to be ready */
  waitForPanelSnapshotReadiness: (
    reason: string,
    maxWaitMs?: number,
    workspaceOverride?: string | null,
  ) => Promise<boolean>
}

// ============================================================================
// Hook
// ============================================================================

export function useWorkspacePanelSnapshots({
  refs,
  featureEnabled,
  liveStateEnabled,
  v2Enabled,
  emitDebugLog,
  getWorkspaceNoteMembership,
  currentWorkspaceId,
  sharedWorkspace,
}: UseWorkspacePanelSnapshotsOptions): UseWorkspacePanelSnapshotsResult {
  const {
    panelSnapshotsRef,
    workspaceSnapshotsRef,
    lastNonEmptySnapshotsRef,
    workspaceNoteMembershipRef,
    ownedNotesRef,
    inferredWorkspaceNotesRef,
    snapshotOwnerWorkspaceIdRef,
    currentWorkspaceIdRef,
    lastPanelSnapshotHashRef,
    lastPendingTimestampRef,
    replayingWorkspaceRef,
  } = refs

  // ---------------------------------------------------------------------------
  // filterPanelsForWorkspace
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // getRuntimeDataStore
  // ---------------------------------------------------------------------------
  const getRuntimeDataStore = useCallback(
    (workspaceId: string | null | undefined): DataStore | null => {
      if (!liveStateEnabled || !workspaceId) return null
      return getWorkspaceRuntime(workspaceId).dataStore
    },
    [liveStateEnabled],
  )

  // ---------------------------------------------------------------------------
  // getWorkspaceDataStore
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // collectPanelSnapshotsFromDataStore
  // ---------------------------------------------------------------------------
  const collectPanelSnapshotsFromDataStore = useCallback(
    (targetWorkspaceId?: string | null): NoteWorkspacePanelSnapshot[] => {
      const snapshots: NoteWorkspacePanelSnapshot[] = []
      // FIX 9: Prefer targetWorkspaceId if explicitly provided by caller (e.g., buildPayload)
      const activeWorkspaceId =
        targetWorkspaceId ??
        snapshotOwnerWorkspaceIdRef.current ??
        currentWorkspaceIdRef.current ??
        currentWorkspaceId
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
            (snapshot) =>
              snapshot.noteId && ownedNotesForWorkspace.get(snapshot.noteId) === activeWorkspaceId,
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
    },
    [
      currentWorkspaceId,
      getWorkspaceDataStore,
      getWorkspaceNoteMembership,
      sharedWorkspace,
      v2Enabled,
      snapshotOwnerWorkspaceIdRef,
      currentWorkspaceIdRef,
      ownedNotesRef,
      inferredWorkspaceNotesRef,
    ],
  )

  // ---------------------------------------------------------------------------
  // getAllPanelSnapshots
  // ---------------------------------------------------------------------------
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
    [
      collectPanelSnapshotsFromDataStore,
      currentWorkspaceId,
      snapshotOwnerWorkspaceIdRef,
      currentWorkspaceIdRef,
      workspaceSnapshotsRef,
      lastNonEmptySnapshotsRef,
      panelSnapshotsRef,
    ],
  )

  // ---------------------------------------------------------------------------
  // updatePanelSnapshotMap
  // ---------------------------------------------------------------------------
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
        panels.length > 0 ? panels : allowEmpty ? [] : fallbackPanels
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
    [
      emitDebugLog,
      v2Enabled,
      getWorkspaceDataStore,
      currentWorkspaceId,
      snapshotOwnerWorkspaceIdRef,
      currentWorkspaceIdRef,
      lastNonEmptySnapshotsRef,
      workspaceSnapshotsRef,
      lastPanelSnapshotHashRef,
      workspaceNoteMembershipRef,
      panelSnapshotsRef,
    ],
  )

  // ---------------------------------------------------------------------------
  // DataStore mutation effect - sync panel snapshots on changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const activeWorkspaceId =
      snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
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
    v2Enabled,
    snapshotOwnerWorkspaceIdRef,
    currentWorkspaceIdRef,
    replayingWorkspaceRef,
    lastPanelSnapshotHashRef,
  ])

  // ---------------------------------------------------------------------------
  // waitForPanelSnapshotReadiness
  // ---------------------------------------------------------------------------
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
    [
      currentWorkspaceId,
      emitDebugLog,
      featureEnabled,
      v2Enabled,
      snapshotOwnerWorkspaceIdRef,
      currentWorkspaceIdRef,
      replayingWorkspaceRef,
      lastPendingTimestampRef,
    ],
  )

  return {
    filterPanelsForWorkspace,
    getRuntimeDataStore,
    getWorkspaceDataStore,
    collectPanelSnapshotsFromDataStore,
    getAllPanelSnapshots,
    updatePanelSnapshotMap,
    waitForPanelSnapshotReadiness,
  }
}
