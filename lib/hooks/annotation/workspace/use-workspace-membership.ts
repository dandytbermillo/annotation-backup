/**
 * Workspace membership and open notes management.
 * Tracks which notes belong to which workspace.
 *
 * Extracted from use-note-workspaces.ts for maintainability.
 * @see docs/proposal/refactor/use-note-workspaces/REFACTORING_PLAN.md
 */

import { useCallback } from "react"
import type { WorkspaceRefs } from "./workspace-refs"
import type { NoteWorkspaceSlot } from "@/lib/workspace/types"
import {
  getRuntimeOpenNotes,
  setRuntimeOpenNotes,
  getRuntimeMembership,
  setRuntimeMembership,
  setRuntimeNoteOwner,
  clearRuntimeNoteOwner,
  getCapturedEvictionState,
} from "@/lib/workspace/runtime-manager"
import {
  setNoteWorkspaceOwner,
  clearNoteWorkspaceOwner,
} from "@/lib/note-workspaces/state"
import { debugLog } from "@/lib/utils/debug-logger"
import {
  normalizeWorkspaceSlots,
  areWorkspaceSlotsEqual,
  ensureWorkspaceSnapshotCache,
} from "./workspace-utils"

// ============================================================================
// Types
// ============================================================================

export interface UseWorkspaceMembershipOptions {
  /** All workspace refs from useWorkspaceRefs */
  refs: WorkspaceRefs
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
  /** Open notes from provider (legacy mode fallback) */
  openNotes: NoteWorkspaceSlot[]
  /** Workspace ID that owns the openNotes array (legacy mode fallback) */
  openNotesWorkspaceId: string | null
}

export interface UseWorkspaceMembershipResult {
  /** Set membership for a workspace (which notes belong to it) */
  setWorkspaceNoteMembership: (
    workspaceId: string | null | undefined,
    noteIds: Iterable<string | null | undefined>,
    timestamp?: number,
  ) => void
  /** Get membership for a workspace */
  getWorkspaceNoteMembership: (workspaceId: string | null | undefined) => Set<string> | null
  /** Commit open notes to a workspace */
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
  /** Get open notes for a workspace */
  getWorkspaceOpenNotes: (workspaceId: string | null | undefined) => NoteWorkspaceSlot[]
}

// ============================================================================
// Hook
// ============================================================================

export function useWorkspaceMembership({
  refs,
  liveStateEnabled,
  v2Enabled,
  emitDebugLog,
  openNotes,
  openNotesWorkspaceId,
}: UseWorkspaceMembershipOptions): UseWorkspaceMembershipResult {
  const {
    workspaceNoteMembershipRef,
    workspaceOpenNotesRef,
    ownedNotesRef,
    workspaceSnapshotsRef,
    replayingWorkspaceRef,
    isHydratingRef,
  } = refs

  // ---------------------------------------------------------------------------
  // setWorkspaceNoteMembership
  // ---------------------------------------------------------------------------
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
    [liveStateEnabled, v2Enabled, emitDebugLog, workspaceNoteMembershipRef, ownedNotesRef],
  )

  // ---------------------------------------------------------------------------
  // getWorkspaceNoteMembership
  // ---------------------------------------------------------------------------
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
    [liveStateEnabled, workspaceNoteMembershipRef],
  )

  // ---------------------------------------------------------------------------
  // commitWorkspaceOpenNotes
  // ---------------------------------------------------------------------------
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
    [liveStateEnabled, setWorkspaceNoteMembership, workspaceOpenNotesRef, workspaceSnapshotsRef],
  )

  // ---------------------------------------------------------------------------
  // getWorkspaceOpenNotes
  // ---------------------------------------------------------------------------
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
    [
      commitWorkspaceOpenNotes,
      liveStateEnabled,
      openNotes,
      openNotesWorkspaceId,
      workspaceOpenNotesRef,
      workspaceSnapshotsRef,
      workspaceNoteMembershipRef,
      replayingWorkspaceRef,
      isHydratingRef,
    ],
  )

  return {
    setWorkspaceNoteMembership,
    getWorkspaceNoteMembership,
    commitWorkspaceOpenNotes,
    getWorkspaceOpenNotes,
  }
}
