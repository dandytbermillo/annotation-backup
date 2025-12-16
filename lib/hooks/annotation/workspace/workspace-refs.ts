/**
 * Workspace refs management hook.
 * Centralizes all useRef declarations for workspace management.
 *
 * Extracted from use-note-workspaces.ts for maintainability.
 * @see docs/proposal/refactor/use-note-workspaces/REFACTORING_PLAN.md
 */

import { useRef, type MutableRefObject } from "react"
import type { NoteWorkspaceAdapter } from "@/lib/adapters/note-workspace-adapter"
import type {
  NoteWorkspacePanelSnapshot,
  NoteWorkspaceComponentSnapshot,
} from "@/lib/types/note-workspace"
import type { NoteWorkspaceSlot } from "@/lib/workspace/types"
import type { NoteWorkspaceSnapshot } from "@/lib/note-workspaces/state"
import type { NoteWorkspaceDebugLogger, EnsureRuntimeResult } from "@/lib/hooks/annotation/use-note-workspace-runtime-manager"
import type { DataStore } from "@/lib/data-store"
import { DEFAULT_CAMERA, type WorkspaceSnapshotCache } from "./workspace-utils"

// ============================================================================
// Types
// ============================================================================

/** All workspace refs bundled together */
export interface WorkspaceRefs {
  // Adapter
  adapterRef: MutableRefObject<NoteWorkspaceAdapter | null>

  // Snapshot storage
  panelSnapshotsRef: MutableRefObject<Map<string, NoteWorkspacePanelSnapshot[]>>
  workspaceSnapshotsRef: MutableRefObject<Map<string, WorkspaceSnapshotCache>>
  lastNonEmptySnapshotsRef: MutableRefObject<Map<string, NoteWorkspacePanelSnapshot[]>>
  lastPreviewedSnapshotRef: MutableRefObject<Map<string, NoteWorkspaceSnapshot | null>>
  lastComponentsSnapshotRef: MutableRefObject<Map<string, NoteWorkspaceComponentSnapshot[]>>

  // Open notes & membership
  workspaceOpenNotesRef: MutableRefObject<Map<string, NoteWorkspaceSlot[]>>
  workspaceNoteMembershipRef: MutableRefObject<Map<string, Set<string>>>
  ownedNotesRef: MutableRefObject<Map<string, string>>
  inferredWorkspaceNotesRef: MutableRefObject<Map<string, Set<string>>>

  // Workspace state tracking
  snapshotOwnerWorkspaceIdRef: MutableRefObject<string | null>
  currentWorkspaceIdRef: MutableRefObject<string | null>
  workspaceRevisionRef: MutableRefObject<Map<string, string | null>>
  workspaceStoresRef: MutableRefObject<Map<string, DataStore>>
  previousVisibleWorkspaceRef: MutableRefObject<string | null>
  lastHydratedWorkspaceIdRef: MutableRefObject<string | null>

  // Save state tracking
  lastPendingTimestampRef: MutableRefObject<Map<string, number>>
  lastSavedPayloadHashRef: MutableRefObject<Map<string, string>>
  lastPanelSnapshotHashRef: MutableRefObject<string | null>
  lastSaveReasonRef: MutableRefObject<string>
  saveInFlightRef: MutableRefObject<Map<string, boolean>>
  skipSavesUntilRef: MutableRefObject<Map<string, number>>
  workspaceDirtyRef: MutableRefObject<Map<string, number>>
  saveTimeoutRef: MutableRefObject<Map<string, NodeJS.Timeout>>

  // Hydration & replay state
  isHydratingRef: MutableRefObject<boolean>
  replayingWorkspaceRef: MutableRefObject<number>
  lastCameraRef: MutableRefObject<{ x: number; y: number; scale: number }>

  // Entry tracking
  previousEntryIdRef: MutableRefObject<string | null>

  // UI state
  unavailableNoticeShownRef: MutableRefObject<boolean>
  listedOnceRef: MutableRefObject<boolean>

  // Retry/loop breakers
  captureRetryAttemptsRef: MutableRefObject<Map<string, number>>
  deferredCachedCaptureCountRef: MutableRefObject<Map<string, number>>
  /** Track retry attempts for inconsistent persist state (openNotes=0 but panels>0) */
  inconsistentPersistRetryRef: MutableRefObject<Map<string, number>>

  // Function refs (for stable callbacks in pre-eviction)
  persistWorkspaceByIdRef: MutableRefObject<
    ((workspaceId: string, reason: string, options?: { skipReadinessCheck?: boolean; isBackground?: boolean }) => Promise<boolean>) | null
  >
  captureSnapshotRef: MutableRefObject<
    ((workspaceId?: string | null, options?: { readinessReason?: string; readinessMaxWaitMs?: number; skipReadiness?: boolean }) => Promise<void>) | null
  >
  emitDebugLogRef: MutableRefObject<((payload: Parameters<NonNullable<NoteWorkspaceDebugLogger>>[0]) => void) | null>

  // Ref for ensureRuntimePrepared (resolves circular dependency with useWorkspaceSnapshot)
  ensureRuntimePreparedRef: MutableRefObject<
    ((workspaceId: string, reason: string) => Promise<EnsureRuntimeResult>) | null
  >

  // Ref for pruneWorkspaceEntries (resolves ordering dependency with useWorkspaceSnapshot)
  pruneWorkspaceEntriesRef: MutableRefObject<
    ((workspaceId: string | null | undefined, observedNoteIds: Set<string>, reason: string) => boolean) | null
  >
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Initialize all workspace refs.
 * Call this once at the top of useNoteWorkspaces.
 *
 * @param initialEntryId - Initial entry ID for previousEntryIdRef
 */
export function useWorkspaceRefs(initialEntryId: string | null): WorkspaceRefs {
  // Adapter
  const adapterRef = useRef<NoteWorkspaceAdapter | null>(null)

  // Snapshot storage
  const panelSnapshotsRef = useRef<Map<string, NoteWorkspacePanelSnapshot[]>>(new Map())
  const workspaceSnapshotsRef = useRef<Map<string, WorkspaceSnapshotCache>>(new Map())
  const lastNonEmptySnapshotsRef = useRef<Map<string, NoteWorkspacePanelSnapshot[]>>(new Map())
  const lastPreviewedSnapshotRef = useRef<Map<string, NoteWorkspaceSnapshot | null>>(new Map())
  const lastComponentsSnapshotRef = useRef<Map<string, NoteWorkspaceComponentSnapshot[]>>(new Map())

  // Open notes & membership
  const workspaceOpenNotesRef = useRef<Map<string, NoteWorkspaceSlot[]>>(new Map())
  const workspaceNoteMembershipRef = useRef<Map<string, Set<string>>>(new Map())
  const ownedNotesRef = useRef<Map<string, string>>(new Map())
  const inferredWorkspaceNotesRef = useRef<Map<string, Set<string>>>(new Map())

  // Workspace state tracking
  const snapshotOwnerWorkspaceIdRef = useRef<string | null>(null)
  const currentWorkspaceIdRef = useRef<string | null>(null)
  const workspaceRevisionRef = useRef<Map<string, string | null>>(new Map())
  const workspaceStoresRef = useRef<Map<string, DataStore>>(new Map())
  const previousVisibleWorkspaceRef = useRef<string | null>(null)
  const lastHydratedWorkspaceIdRef = useRef<string | null>(null)

  // Save state tracking
  const lastPendingTimestampRef = useRef<Map<string, number>>(new Map())
  const lastSavedPayloadHashRef = useRef<Map<string, string>>(new Map())
  const lastPanelSnapshotHashRef = useRef<string | null>(null)
  const lastSaveReasonRef = useRef<string>("initial_schedule")
  const saveInFlightRef = useRef<Map<string, boolean>>(new Map())
  const skipSavesUntilRef = useRef<Map<string, number>>(new Map())
  const workspaceDirtyRef = useRef<Map<string, number>>(new Map())
  const saveTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Hydration & replay state
  const isHydratingRef = useRef(false)
  const replayingWorkspaceRef = useRef(0)
  const lastCameraRef = useRef(DEFAULT_CAMERA)

  // Entry tracking
  const previousEntryIdRef = useRef<string | null>(initialEntryId)

  // UI state
  const unavailableNoticeShownRef = useRef(false)
  const listedOnceRef = useRef(false)

  // Retry/loop breakers
  const captureRetryAttemptsRef = useRef<Map<string, number>>(new Map())
  const deferredCachedCaptureCountRef = useRef<Map<string, number>>(new Map())
  /** Track retry attempts for inconsistent persist state (openNotes=0 but panels>0) */
  const inconsistentPersistRetryRef = useRef<Map<string, number>>(new Map())

  // Function refs (for stable callbacks in pre-eviction)
  const persistWorkspaceByIdRef = useRef<
    ((workspaceId: string, reason: string, options?: { skipReadinessCheck?: boolean; isBackground?: boolean }) => Promise<boolean>) | null
  >(null)
  const captureSnapshotRef = useRef<
    ((workspaceId?: string | null, options?: { readinessReason?: string; readinessMaxWaitMs?: number; skipReadiness?: boolean }) => Promise<void>) | null
  >(null)
  const emitDebugLogRef = useRef<((payload: Parameters<NonNullable<NoteWorkspaceDebugLogger>>[0]) => void) | null>(null)

  // Ref for ensureRuntimePrepared (resolves circular dependency with useWorkspaceSnapshot)
  const ensureRuntimePreparedRef = useRef<
    ((workspaceId: string, reason: string) => Promise<EnsureRuntimeResult>) | null
  >(null)

  // Ref for pruneWorkspaceEntries (resolves ordering dependency with useWorkspaceSnapshot)
  const pruneWorkspaceEntriesRef = useRef<
    ((workspaceId: string | null | undefined, observedNoteIds: Set<string>, reason: string) => boolean) | null
  >(null)

  return {
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
    inconsistentPersistRetryRef,
    persistWorkspaceByIdRef,
    captureSnapshotRef,
    emitDebugLogRef,
    ensureRuntimePreparedRef,
    pruneWorkspaceEntriesRef,
  }
}
