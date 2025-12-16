/**
 * Workspace CRUD operations hook.
 * Extracted from use-note-workspaces.ts for maintainability.
 *
 * Handles: Create, Delete, Rename workspace operations.
 *
 * @see docs/proposal/refactor/use-note-workspaces/REFACTORING_PLAN.md
 */

import { useCallback, type MutableRefObject, type Dispatch, type SetStateAction } from "react"

import { NoteWorkspaceAdapter, type NoteWorkspaceSummary } from "@/lib/adapters/note-workspace-adapter"
import { clearNoteWorkspaceOwner } from "@/lib/note-workspaces/state"
import type { NoteWorkspacePayload } from "@/lib/types/note-workspace"
import type { NoteWorkspaceSlot } from "@/lib/workspace/types"

import { DEFAULT_CAMERA, formatSyncedLabel } from "./workspace-utils"
import type { EnsureRuntimeResult } from "@/lib/hooks/annotation/use-note-workspace-runtime-manager"

// ============================================================================
// Types
// ============================================================================

type DebugLogFn = (payload: {
  component: string
  action: string
  metadata?: Record<string, unknown>
}) => void

type CommitOpenNotesOptions = {
  updateCache?: boolean
  callSite?: string
}

export type UseWorkspaceCrudOptions = {
  /** Whether the workspace feature is enabled */
  featureEnabled: boolean
  /** Current entry ID context */
  currentEntryId: string | null
  /** Current workspace ID */
  currentWorkspaceId: string | null
  /** List of all workspaces */
  workspaces: NoteWorkspaceSummary[]
  /** Adapter ref for API calls */
  adapterRef: MutableRefObject<NoteWorkspaceAdapter | null>
  /** Ref tracking workspace → note membership */
  workspaceNoteMembershipRef: MutableRefObject<Map<string, Set<string>>>
  /** Ref tracking workspace → open notes */
  workspaceOpenNotesRef: MutableRefObject<Map<string, NoteWorkspaceSlot[]>>
  /** Ref tracking note → owner workspace */
  ownedNotesRef: MutableRefObject<Map<string, string>>
  /** Set workspaces state */
  setWorkspaces: Dispatch<SetStateAction<NoteWorkspaceSummary[]>>
  /** Set current workspace ID */
  setCurrentWorkspaceId: Dispatch<SetStateAction<string | null>>
  /** Set status helper text */
  setStatusHelperText: Dispatch<SetStateAction<string | null>>
  /** Set workspace note membership */
  setWorkspaceNoteMembership: (workspaceId: string, noteIds: string[]) => void
  /** Commit workspace open notes */
  commitWorkspaceOpenNotes: (
    workspaceId: string,
    slots: NoteWorkspaceSlot[],
    options?: CommitOpenNotesOptions
  ) => void
  /** Ensure runtime is prepared for workspace */
  ensureRuntimePrepared: (workspaceId: string, context: string) => Promise<EnsureRuntimeResult>
  /** Flush any pending save operations */
  flushPendingSave: (reason: string) => void
  /** Build payload for current workspace */
  buildPayload: () => NoteWorkspacePayload
  /** Debug logger */
  emitDebugLog: DebugLogFn
}

export type WorkspaceCrudHandlers = {
  /** Create a new workspace */
  createWorkspace: () => Promise<void>
  /** Delete a workspace */
  deleteWorkspace: (workspaceId: string) => Promise<void>
  /** Rename a workspace */
  renameWorkspace: (workspaceId: string, nextName: string) => Promise<void>
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useWorkspaceCrud({
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
}: UseWorkspaceCrudOptions): WorkspaceCrudHandlers {
  // ---------------------------------------------------------------------------
  // Create Workspace
  // ---------------------------------------------------------------------------

  const createWorkspace = useCallback(async () => {
    if (!featureEnabled || !adapterRef.current) return

    // Flush any pending save before creating
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

      // Gap 5 fix: Handle blocked result from ensureRuntimePrepared
      const runtimeResult = await ensureRuntimePrepared(workspace.id, "create_workspace")
      if (!runtimeResult.ok) {
        // Runtime creation was blocked - can't switch to new workspace
        emitDebugLog({
          component: "NoteWorkspace",
          action: "create_blocked",
          metadata: {
            workspaceId: workspace.id,
            blocked: runtimeResult.blocked,
            blockedWorkspaceId: runtimeResult.blockedWorkspaceId,
          },
        })
        // Delete the newly created workspace since we can't use it
        try {
          await adapterRef.current?.deleteWorkspace(workspace.id)
        } catch (deleteError) {
          console.error("[NoteWorkspace] failed to cleanup blocked workspace", deleteError)
        }
        return
      }

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
    setCurrentWorkspaceId,
    setStatusHelperText,
    setWorkspaceNoteMembership,
    setWorkspaces,
    adapterRef,
  ])

  // ---------------------------------------------------------------------------
  // Delete Workspace
  // ---------------------------------------------------------------------------

  const deleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!adapterRef.current) return

      try {
        await adapterRef.current.deleteWorkspace(workspaceId)

        setWorkspaces((prev) => prev.filter((workspace) => workspace.id !== workspaceId))

        // Clean up membership and open notes refs
        workspaceNoteMembershipRef.current.delete(workspaceId)
        workspaceOpenNotesRef.current.delete(workspaceId)

        // Clean up owned notes
        Array.from(ownedNotesRef.current.entries()).forEach(([noteId, ownerWorkspaceId]) => {
          if (ownerWorkspaceId === workspaceId) {
            clearNoteWorkspaceOwner(noteId)
            ownedNotesRef.current.delete(noteId)
          }
        })

        // If deleted workspace was current, switch to another
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
    [
      adapterRef,
      currentWorkspaceId,
      emitDebugLog,
      ownedNotesRef,
      setCurrentWorkspaceId,
      setStatusHelperText,
      setWorkspaces,
      workspaceNoteMembershipRef,
      workspaceOpenNotesRef,
      workspaces,
    ],
  )

  // ---------------------------------------------------------------------------
  // Rename Workspace
  // ---------------------------------------------------------------------------

  const renameWorkspace = useCallback(
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
    [adapterRef, buildPayload, currentWorkspaceId, setStatusHelperText, setWorkspaces, workspaces],
  )

  // ---------------------------------------------------------------------------
  // Return Handlers
  // ---------------------------------------------------------------------------

  return {
    createWorkspace,
    deleteWorkspace,
    renameWorkspace,
  }
}
