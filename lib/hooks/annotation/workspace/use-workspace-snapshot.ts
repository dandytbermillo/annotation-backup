/**
 * Workspace snapshot capture and apply management.
 * Handles capturing current state and applying snapshots to restore workspaces.
 *
 * Extracted from use-note-workspaces.ts for maintainability.
 * @see docs/proposal/refactor/use-note-workspaces/REFACTORING_PLAN.md
 */

import { useCallback } from "react"
import type { WorkspaceRefs } from "./workspace-refs"
import type { NoteWorkspaceSlot, NoteWorkspace } from "@/lib/workspace/types"
import type {
  NoteWorkspacePayload,
  NoteWorkspacePanelSnapshot,
  NoteWorkspaceComponentSnapshot,
} from "@/lib/types/note-workspace"
import type { NoteWorkspaceSnapshot } from "@/lib/note-workspaces/state"
import type { LayerContextValue } from "@/components/canvas/layer-provider"
import type { CanvasState } from "@/lib/hooks/annotation/use-workspace-canvas-state"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
import { getWorkspaceLayerManager } from "@/lib/workspace/workspace-layer-manager-registry"
import {
  hasWorkspaceRuntime,
  getRuntimeMembership,
  getRuntimeOpenNotes,
  getRegisteredComponentCount,
  getRuntimeComponentCount,
  populateRuntimeComponents,
} from "@/lib/workspace/runtime-manager"
import {
  cacheWorkspaceSnapshot,
  getWorkspaceSnapshot,
} from "@/lib/note-workspaces/state"
import {
  DEFAULT_CAMERA,
  CAPTURE_DEFER_DELAY_MS,
  serializePanelSnapshots,
  ensureWorkspaceSnapshotCache,
  getLastNonEmptySnapshot,
  mergePanelSnapshots,
  mergeComponentSnapshots,
} from "./workspace-utils"

// ============================================================================
// Types
// ============================================================================

export interface UseWorkspaceSnapshotOptions {
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
  /** Active note ID */
  activeNoteId: string | null
  /** Canvas state */
  canvasState: CanvasState | null
  /** Layer context */
  layerContext: LayerContextValue | null
  /** Shared workspace reference */
  sharedWorkspace: NoteWorkspace | null
  /** Open notes from provider */
  openNotes: NoteWorkspaceSlot[]
  /** Max deferred capture count */
  maxDeferredCachedCaptures: number
  /** Function to bump snapshot revision */
  bumpSnapshotRevision: () => void
  /** Function to set active note ID */
  setActiveNoteId: (noteId: string | null) => void
  /** Function to set canvas state */
  setCanvasState: React.Dispatch<React.SetStateAction<CanvasState>> | null

  // Functions from other hooks
  /** Get workspace DataStore */
  getWorkspaceDataStore: (workspaceId: string | null | undefined) => any
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
  /** Filter panels for workspace */
  filterPanelsForWorkspace: (
    workspaceId: string | null | undefined,
    panels: NoteWorkspacePanelSnapshot[],
  ) => NoteWorkspacePanelSnapshot[]
  /** Collect panel snapshots from DataStore */
  collectPanelSnapshotsFromDataStore: (targetWorkspaceId?: string | null) => NoteWorkspacePanelSnapshot[]
  /** Update panel snapshot map */
  updatePanelSnapshotMap: (
    panels: NoteWorkspacePanelSnapshot[],
    reason: string,
    options?: { allowEmpty?: boolean; mergeWithExisting?: boolean },
  ) => void
  /** Wait for panel snapshot readiness */
  waitForPanelSnapshotReadiness: (
    reason: string,
    maxWaitMs?: number,
    workspaceOverride?: string | null,
  ) => Promise<boolean>
  /** Prune workspace entries */
  pruneWorkspaceEntries: (
    workspaceId: string | null | undefined,
    observedNoteIds: Set<string>,
    reason: string,
  ) => boolean
  /** Resolve main panel position */
  resolveMainPanelPosition: (noteId: string) => { x: number; y: number } | null
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
  /** Ensure runtime is prepared */
  ensureRuntimePrepared: (workspaceId: string, reason: string) => Promise<void>
}

export interface UseWorkspaceSnapshotResult {
  /** Apply panel snapshots to DataStore */
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
  /** Capture current workspace snapshot */
  captureCurrentWorkspaceSnapshot: (
    targetWorkspaceId?: string | null,
    options?: { readinessReason?: string; readinessMaxWaitMs?: number; skipReadiness?: boolean },
  ) => Promise<void>
  /** Build payload from snapshot */
  buildPayloadFromSnapshot: (workspaceId: string, snapshot: NoteWorkspaceSnapshot) => NoteWorkspacePayload
  /** Rehydrate panels for a single note */
  rehydratePanelsForNote: (noteId: string, workspaceId?: string) => void
  /** Preview workspace from snapshot */
  previewWorkspaceFromSnapshot: (
    workspaceId: string,
    snapshot: NoteWorkspaceSnapshot,
    options?: { force?: boolean },
  ) => Promise<void>
}

// ============================================================================
// Hook
// ============================================================================

export function useWorkspaceSnapshot({
  refs,
  featureEnabled,
  liveStateEnabled,
  v2Enabled,
  emitDebugLog,
  currentWorkspaceId,
  activeNoteId,
  canvasState,
  layerContext,
  sharedWorkspace,
  openNotes,
  maxDeferredCachedCaptures,
  bumpSnapshotRevision,
  setActiveNoteId,
  setCanvasState,
  getWorkspaceDataStore,
  getWorkspaceNoteMembership,
  setWorkspaceNoteMembership,
  commitWorkspaceOpenNotes,
  getWorkspaceOpenNotes,
  filterPanelsForWorkspace,
  collectPanelSnapshotsFromDataStore,
  updatePanelSnapshotMap,
  waitForPanelSnapshotReadiness,
  pruneWorkspaceEntries,
  resolveMainPanelPosition,
  openWorkspaceNote,
  closeWorkspaceNote,
  ensureRuntimePrepared,
}: UseWorkspaceSnapshotOptions): UseWorkspaceSnapshotResult {
  const {
    panelSnapshotsRef,
    workspaceSnapshotsRef,
    lastNonEmptySnapshotsRef,
    lastPreviewedSnapshotRef,
    lastComponentsSnapshotRef,
    snapshotOwnerWorkspaceIdRef,
    currentWorkspaceIdRef,
    lastPanelSnapshotHashRef,
    replayingWorkspaceRef,
    inferredWorkspaceNotesRef,
    captureRetryAttemptsRef,
    deferredCachedCaptureCountRef,
    skipSavesUntilRef,
  } = refs

  // ---------------------------------------------------------------------------
  // applyPanelSnapshots
  // ---------------------------------------------------------------------------
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
      getWorkspaceDataStore,
      liveStateEnabled,
      snapshotOwnerWorkspaceIdRef,
      currentWorkspaceIdRef,
      replayingWorkspaceRef,
      lastPanelSnapshotHashRef,
    ],
  )

  // ---------------------------------------------------------------------------
  // captureCurrentWorkspaceSnapshot
  // ---------------------------------------------------------------------------
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
            const currentMembership = getRuntimeMembership(workspaceId)
            const allMissingAreInMembership = missingCachedNotes.every(
              (noteId) => currentMembership?.has(noteId) ?? false
            )

            if (allMissingAreInMembership && currentMembership && currentMembership.size >= cachedNoteIds.size) {
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
            } else {
              const deferredCount = deferredCachedCaptureCountRef.current.get(workspaceId) ?? 0
              if (deferredCount >= maxDeferredCachedCaptures) {
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
                deferredCachedCaptureCountRef.current.delete(workspaceId)
                return
              } else {
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
      // FIX: In live-state mode, runtime is the source of truth for open notes.
      // Notes in DataStore panels that aren't in runtime were likely closed.
      // Don't seed them back - that would restore deleted notes.
      // Only compute missingOpenNotes for non-live-state mode.
      const missingOpenNotes = liveStateEnabled
        ? [] // In live-state mode, runtime is authoritative - don't seed from stale DataStore
        : Array.from(observedNoteIds).filter((noteId) => !openNoteIds.has(noteId))

      if (liveStateEnabled && observedNoteIds.size > openNoteIds.size) {
        // Log that we're skipping seed due to live state (for debugging)
        const skippedNotes = Array.from(observedNoteIds).filter((noteId) => !openNoteIds.has(noteId))
        if (skippedNotes.length > 0) {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "snapshot_open_note_seed_skipped_live_state",
            metadata: {
              workspaceId,
              skippedNoteIds: skippedNotes,
              runtimeOpenNoteIds: Array.from(openNoteIds),
              observedNoteIds: Array.from(observedNoteIds),
              reason: "runtime_is_authoritative_in_live_state",
            },
          })
        }
      }

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
      maxDeferredCachedCaptures,
      snapshotOwnerWorkspaceIdRef,
      currentWorkspaceIdRef,
      workspaceSnapshotsRef,
      lastNonEmptySnapshotsRef,
      lastPanelSnapshotHashRef,
      inferredWorkspaceNotesRef,
      captureRetryAttemptsRef,
      deferredCachedCaptureCountRef,
      lastComponentsSnapshotRef,
      lastPreviewedSnapshotRef,
    ],
  )

  // ---------------------------------------------------------------------------
  // buildPayloadFromSnapshot
  // ---------------------------------------------------------------------------
  const buildPayloadFromSnapshot = useCallback(
    (workspaceId: string, snapshot: NoteWorkspaceSnapshot): NoteWorkspacePayload => {
      const normalizedOpenNotes = snapshot.openNotes.map((entry) => ({
        noteId: entry.noteId,
        position: entry.mainPosition ?? null,
      }))
      const active = snapshot.activeNoteId ?? normalizedOpenNotes[0]?.noteId ?? null

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
    [lastComponentsSnapshotRef],
  )

  // ---------------------------------------------------------------------------
  // rehydratePanelsForNote
  // ---------------------------------------------------------------------------
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
    [applyPanelSnapshots, workspaceSnapshotsRef, panelSnapshotsRef],
  )

  // ---------------------------------------------------------------------------
  // previewWorkspaceFromSnapshot
  // ---------------------------------------------------------------------------
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
          return
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
      const runtimeState = liveStateEnabled && hasWorkspaceRuntime(workspaceId) ? "hot" : "cold"

      if (runtimeState === "hot") {
        const runtimeLedgerCount = getRuntimeComponentCount(workspaceId)
        const runtimeComponentCount = getRegisteredComponentCount(workspaceId)

        if (snapshot.components && snapshot.components.length > 0) {
          if (runtimeLedgerCount === 0) {
            populateRuntimeComponents(workspaceId, snapshot.components)
          }

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

      if (snapshot.components && snapshot.components.length > 0) {
        populateRuntimeComponents(workspaceId, snapshot.components)
      }

      const normalizedOpenNotes = snapshot.openNotes.map((entry) => ({
        noteId: entry.noteId,
        mainPosition: entry.mainPosition ?? null,
      }))

      const openNotesToCommit = normalizedOpenNotes
      cache.openNotes = openNotesToCommit

      commitWorkspaceOpenNotes(workspaceId, openNotesToCommit, { updateMembership: false, callSite: "replaySnapshot" })
      updatePanelSnapshotMap(scopedPanels, "preview_snapshot", { allowEmpty: true })
      const panelNoteIds = new Set(scopedPanels.map((panel) => panel.noteId).filter(Boolean) as string[])
      panelNoteIds.forEach((id) => targetIds.add(id))
      applyPanelSnapshots(scopedPanels, panelNoteIds, snapshot.components, {
        allowEmptyApply: true,
        suppressMutationEvents: true,
        reason: "preview_snapshot",
      })

      openNotesToCommit.forEach(n => targetIds.add(n.noteId))

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
      openNotes,
      setWorkspaceNoteMembership,
      setActiveNoteId,
      setCanvasState,
      updatePanelSnapshotMap,
      snapshotOwnerWorkspaceIdRef,
      lastPreviewedSnapshotRef,
      workspaceSnapshotsRef,
      skipSavesUntilRef,
    ],
  )

  return {
    applyPanelSnapshots,
    captureCurrentWorkspaceSnapshot,
    buildPayloadFromSnapshot,
    rehydratePanelsForNote,
    previewWorkspaceFromSnapshot,
  }
}
