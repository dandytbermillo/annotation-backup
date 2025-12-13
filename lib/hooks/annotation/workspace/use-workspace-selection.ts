/**
 * Workspace selection hook.
 * Extracted from use-note-workspaces.ts for maintainability.
 *
 * Handles: Workspace switching (hot/cold switch logic).
 *
 * @see docs/proposal/refactor/use-note-workspaces/REFACTORING_PLAN.md
 */

import { useCallback, type MutableRefObject, type Dispatch, type SetStateAction } from "react"

import type { NoteWorkspaceAdapter, NoteWorkspaceSummary } from "@/lib/adapters/note-workspace-adapter"
import type { NoteWorkspacePanelSnapshot, NoteWorkspaceComponentSnapshot } from "@/lib/types/note-workspace"
import type { NoteWorkspaceSlot } from "@/lib/workspace/types"
import type { NoteWorkspaceSnapshot } from "@/lib/note-workspaces/state"
import {
  hasWorkspaceRuntime,
  listHotRuntimes,
  setRuntimeVisible,
  setWorkspaceEntry,
} from "@/lib/workspace/runtime-manager"
import {
  getWorkspaceSnapshot,
  setActiveWorkspaceContext,
} from "@/lib/note-workspaces/state"
import { getActiveEntryContext } from "@/lib/entry"

import { DEFAULT_CAMERA, type WorkspaceSnapshotCache } from "./workspace-utils"

// ============================================================================
// Types
// ============================================================================

type DebugLogFn = (payload: {
  component: string
  action: string
  metadata?: Record<string, unknown>
}) => void

export type UseWorkspaceSelectionOptions = {
  /** Whether live state mode is enabled */
  liveStateEnabled: boolean
  /** Whether v2 mode is enabled */
  v2Enabled: boolean
  /** Current workspace ID */
  currentWorkspaceId: string | null
  /** Pending workspace ID (during switch) */
  pendingWorkspaceId: string | null
  /** Set pending workspace ID */
  setPendingWorkspaceId: Dispatch<SetStateAction<string | null>>
  /** Set current workspace ID */
  setCurrentWorkspaceId: Dispatch<SetStateAction<string | null>>
  /** Adapter ref for API calls */
  adapterRef: MutableRefObject<NoteWorkspaceAdapter | null>
  /** Current workspace ID ref */
  currentWorkspaceIdRef: MutableRefObject<string | null>
  /** Snapshot owner workspace ID ref */
  snapshotOwnerWorkspaceIdRef: MutableRefObject<string | null>
  /** Workspace snapshots cache ref */
  workspaceSnapshotsRef: MutableRefObject<Map<string, WorkspaceSnapshotCache>>
  /** Workspace revision ref */
  workspaceRevisionRef: MutableRefObject<Map<string, string | null>>
  /** Set workspace note membership */
  setWorkspaceNoteMembership: (workspaceId: string, noteIds: string[]) => void
  /** Filter panels for workspace */
  filterPanelsForWorkspace: (workspaceId: string | null | undefined, panels: NoteWorkspacePanelSnapshot[]) => NoteWorkspacePanelSnapshot[]
  /** Apply panel snapshots */
  applyPanelSnapshots: (
    panels: NoteWorkspacePanelSnapshot[] | undefined,
    targetNoteIds: Set<string>,
    components?: NoteWorkspaceComponentSnapshot[],
    options?: {
      allowEmptyApply?: boolean
      clearWorkspace?: boolean
      clearComponents?: boolean
      suppressMutationEvents?: boolean
      reason?: string
    }
  ) => void
  /** Capture current workspace snapshot */
  captureCurrentWorkspaceSnapshot: (
    reason?: string,
    options?: { readinessReason?: string; readinessMaxWaitMs?: number }
  ) => Promise<void>
  /** Preview workspace from snapshot */
  previewWorkspaceFromSnapshot: (
    workspaceId: string,
    snapshot: NoteWorkspaceSnapshot,
    options?: { force?: boolean }
  ) => Promise<void>
  /** Persist workspace now */
  persistWorkspaceNow: () => Promise<void>
  /** Ensure runtime is prepared for workspace */
  ensureRuntimePrepared: (workspaceId: string, context: string) => Promise<void>
  /** Last save reason ref */
  lastSaveReasonRef: MutableRefObject<string | null>
  /** Debug logger */
  emitDebugLog: DebugLogFn
}

export type WorkspaceSelectionHandlers = {
  /** Select/switch to a workspace */
  selectWorkspace: (workspaceId: string) => void
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useWorkspaceSelection({
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
}: UseWorkspaceSelectionOptions): WorkspaceSelectionHandlers {
  // ---------------------------------------------------------------------------
  // Select Workspace (Hot/Cold Switch)
  // ---------------------------------------------------------------------------

  const selectWorkspace = useCallback(
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
            const entryId = getActiveEntryContext()
            if (entryId) {
              setWorkspaceEntry(workspaceId, entryId)
            }
            emitDebugLog({
              component: "NoteWorkspace",
              action: "workspace_runtime_visible",
              metadata: { workspaceId, wasCold: true, entryId },
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
      setPendingWorkspaceId,
      setCurrentWorkspaceId,
      currentWorkspaceIdRef,
      snapshotOwnerWorkspaceIdRef,
      workspaceSnapshotsRef,
      lastSaveReasonRef,
    ],
  )

  // ---------------------------------------------------------------------------
  // Return Handlers
  // ---------------------------------------------------------------------------

  return {
    selectWorkspace,
  }
}
